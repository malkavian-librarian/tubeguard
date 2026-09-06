import { STORE } from '../constants.js';
import { idbReq } from './schema.js';
import { transaction, mutate, configIn, charge, checkRun, checkCapture, trustedLocal, pageStore, featureStores, uuid } from './transaction.js';
import { ANALYSIS_DAY_MS, ANALYSIS_LEASE_MS, ANALYSIS_THRESHOLD_MS, ANALYSIS_MIN_DURATION_SECONDS, ANALYSIS_RETENTION_MS, publicConfig, OUTBOX_MAX_FAILURES, OUTBOX_RETRY_BASE_MS, OUTBOX_RETRY_CAP_MS } from '../analysis-contracts.js';
import { assert, validateConfigPatch, validateEvidence, validateCheckpoint, validateSender, CANONICAL_CHANNEL_PATTERN, byteLength } from '../analysis-validation.js';

export const analysisStore = {
  async getConfig() {
    const c = await mutate([], async (_, c) => c), local = await trustedLocal();
    const hasKey = !!(c.keySlotId && (await local.get(c.keySlotId))[c.keySlotId]);
    const { keySlotId, ...safe } = c;
    return { ...safe, hasKey };
  },
  async getApiKey() {
    const c = await mutate([], async (_, c) => c), local = await trustedLocal();
    return c.keySlotId ? (await local.get(c.keySlotId))[c.keySlotId] || null : null;
  },
  async saveConfig(patch) {
    validateConfigPatch(patch); const local = await trustedLocal(); let slot;
    if (patch.apiKey) { slot = 'ai-key-' + uuid(); await local.set({ [slot]: patch.apiKey.trim() }); }
    await mutate([STORE.RUNS], async (tx, c) => {
      const now = patch.now ?? Date.now(), oldEnabled = c.enabled;
      if (slot) c.keySlotId = slot;
      if (patch.keyAction === 'clear') { c.keySlotId = null; c.enabled = false; }
      const changedPolicy = patch.priorities !== undefined && patch.priorities !== c.priorities;
      for (const key of ['enabled','modelId','priorities','maxRequestsPer24h','maxInputBytesPer24h']) if (key in patch) c[key] = patch[key];
      if (c.enabled) assert(c.keySlotId && c.priorities.trim(), 'CONFIG_INCOMPLETE');
      if (changedPolicy || (!oldEnabled && c.enabled)) { c.policyRevision++; c.epochStartedAt = now; }
      if (!oldEnabled && c.enabled && c.epochStartedAt !== null) c.generation = uuid();
      // an in-flight run pinned to the pre-bump configGeneration is about to be orphaned by
      // checkRun's STALE_GENERATION guard; without resetting nextDueAt, analysis would otherwise
      // stall until the next calendar day instead of resuming this run's work today.
      const orphansActiveRun = (await tx.all(STORE.RUNS)).some(r => ['running','waiting_retry','queued'].includes(r.status) && r.configGeneration === c.configGeneration);
      c.configGeneration++;
      if (c.enabled && !oldEnabled) c.nextDueAt = now + ANALYSIS_DAY_MS;
      else if (orphansActiveRun) c.nextDueAt = now;
      if (c.budgetOrigin == null && c.enabled) c.budgetOrigin = now;
      await tx.put(STORE.STATE, c);
    });
    return this.reconcileConfig();
  },
  async reconcileConfig() {
    const local = await trustedLocal(), all = await local.get(null);
    const c = await mutate([], async (tx, c) => {
      if (c.keySlotId && !all[c.keySlotId]) { c.enabled = false; c.keySlotId = null; c.configGeneration++; await tx.put(STORE.STATE, c); }
      return c;
    });
    const orphan = Object.keys(all).filter(k => k.startsWith('ai-key-') && k !== c.keySlotId);
    if (orphan.length) await local.remove(orphan);
    return this.getConfig();
  },
  async beginCapture({ senderIdentity, videoId, navigationId }) {
    const sender = validateSender(senderIdentity);
    assert(/^[\w-]{11}$/.test(videoId) && typeof navigationId === 'string' && navigationId.length < 128);
    return mutate([STORE.CAPTURES,STORE.VIDEOS,STORE.EVIDENCE], async (tx, c) => {
      assert(c.enabled, 'AI_DISABLED');
      const s = { id: uuid(), captureEpoch: uuid(), policyRevision: c.policyRevision, generation: c.generation, sender, videoId, navigationId, lastSequence: 0, createdAt: Date.now() };
      const video=await tx.get(STORE.VIDEOS,videoId),evidence=video?.evidenceVersion?await tx.get(STORE.EVIDENCE,videoId+':'+video.evidenceVersion):null;
      if(evidence){s.evidenceVersion=evidence.evidenceVersion;s.channelId=evidence.channelId;s.channelAliases=evidence.channelAliases;s.identityProvenance=evidence.identityProvenance;s.inheritedEvidence=true;}
      s.sessionId = s.id; await charge(tx, c, s); await tx.put(STORE.CAPTURES, s);
      return { sessionId: s.id, captureEpoch: s.captureEpoch, policyRevision: s.policyRevision, generation: s.generation };
    });
  },
  async upsertEvidence(input, sender) {
    const e = validateEvidence(input);
    const canonical = JSON.stringify([e.videoId,e.channelId,e.channelAliases,e.identityProvenance,e.title,e.description,e.durationSeconds,e.transcript]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    const version = [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2,'0')).join('');
    return mutate([STORE.CAPTURES,STORE.VIDEOS,STORE.EVIDENCE,STORE.CHUNKS], async (tx, c) => {
      const capture = await checkCapture(tx,c,input,sender); const id = e.videoId + ':' + version;
      if (!await tx.get(STORE.EVIDENCE,id)) { const row = { ...e, id, evidenceVersion: version }; await charge(tx,c,row); await tx.put(STORE.EVIDENCE,row); }
      const replaceInherited=capture.inheritedEvidence===true;capture.evidenceVersion = version;
      capture.channelId = e.channelId;
      capture.channelAliases = e.channelAliases;
      capture.identityProvenance = e.identityProvenance;
      capture.inheritedEvidence=false;
      await tx.put(STORE.CAPTURES, capture);
      for (const chunk of await tx.indexed(STORE.CHUNKS, 'videoId', e.videoId)) {
        if (chunk.sessionId !== capture.id || (chunk.evidenceVersion&&!replaceInherited)) continue;
        chunk.evidenceVersion = version;
        chunk.channelId = e.channelId;
        chunk.channelAliases = e.channelAliases;
        chunk.identityProvenance = e.identityProvenance;
        await tx.put(STORE.CHUNKS, chunk);
      }
      const previous = await tx.get(STORE.VIDEOS,e.videoId);
      const recordedMs=previous?.watchMs??(await tx.indexed(STORE.CHUNKS,'videoId',e.videoId)).reduce((n,c)=>n+c.activeMs,0);
      await tx.put(STORE.VIDEOS,{ id:e.videoId,videoId:e.videoId,title:e.title,channelName:e.channelName,channelId:e.channelId,durationSeconds:e.durationSeconds,evidenceVersion:version,firstWatchedAt:previous?.firstWatchedAt ?? null,lastWatchedAt:previous?.lastWatchedAt ?? null,watchMs:recordedMs });
      return { videoId:e.videoId,evidenceVersion:version };
    });
  },
  async acceptCheckpoint(input, senderIdentity) {
    validateCheckpoint(input); validateSender(senderIdentity);
    assert(input.endedAt<=Date.now()+1000,'INVALID_INPUT');
    return mutate([STORE.CAPTURES,STORE.CHUNKS,STORE.SESSIONS,STORE.VIDEOS], async (tx,c) => {
      const s = await checkCapture(tx,c,input,senderIdentity), id=s.id+':'+input.sequence;
      const prior=await tx.get(STORE.CHUNKS,id);
      if(prior)return {accepted:false,chunkId:id,activeMs:prior.activeMs};
      assert(input.sequence===s.lastSequence+1,'SEQUENCE_GAP');
      const all=await tx.indexed(STORE.CHUNKS,'endedAt',IDBKeyRange.lowerBound(input.startedAt)), intervals=[];
      for(const segment of input.activeIntervals){
        let pieces=[[segment.wallStartMs,segment.wallEndMs]];
        for(const row of all)for(const used of row.activeIntervals || [])pieces=pieces.flatMap(([a,b])=> used.wallEndMs<=a||used.wallStartMs>=b?[[a,b]]:[[a,Math.min(b,used.wallStartMs)],[Math.max(a,used.wallEndMs),b]].filter(([x,y])=>y>x));
        const rate=(segment.mediaEndMs-segment.mediaStartMs)/(segment.wallEndMs-segment.wallStartMs);
        for(const [a,b] of pieces)intervals.push({wallStartMs:a,wallEndMs:b,mediaStartMs:Math.round(segment.mediaStartMs+(a-segment.wallStartMs)*rate),mediaEndMs:Math.round(segment.mediaStartMs+(b-segment.wallStartMs)*rate)});
      }
      const activeMs=intervals.reduce((n,i)=>n+i.wallEndMs-i.wallStartMs,0), video=await tx.get(STORE.VIDEOS,input.videoId);
      const chunk={...input,id,activeIntervals:intervals,mediaIntervals:intervals.map(i=>({startMs:i.mediaStartMs,endMs:i.mediaEndMs})),activeMs,policyRevision:s.policyRevision,generation:s.generation,evidenceVersion:s.evidenceVersion??null,channelId:s.channelId??null,channelAliases:s.channelAliases??[],identityProvenance:s.identityProvenance??'',acceptedAt:Date.now()};
      await charge(tx,c,chunk); await tx.put(STORE.CHUNKS,chunk); s.lastSequence=input.sequence; await tx.put(STORE.CAPTURES,s);
      for(const i of intervals){let at=i.wallStartMs;while(at<i.wallEndMs){
        const d=new Date(at), date=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
        const midnight=new Date(d.getFullYear(),d.getMonth(),d.getDate()+1).getTime(), end=Math.min(midnight,i.wallEndMs);
        const row=await tx.index(STORE.SESSIONS,'captureDate',[s.id,date]) || {sessionId:s.id,date,startTime:at,videoId:input.videoId,channelId:video?.channelId || 'unknown',channelName:video?.channelName || 'Unknown',videoTitle:video?.title || input.videoId,duration:0};
        row.duration+=(end-at)/1000; await tx.put(STORE.SESSIONS,row); at=end;
      }}
      if(video){video.watchMs+=activeMs;video.firstWatchedAt=Math.min(video.firstWatchedAt??input.startedAt,input.startedAt);video.lastWatchedAt=Math.max(video.lastWatchedAt??0,input.endedAt);await tx.put(STORE.VIDEOS,video);}
      return {accepted:true,chunkId:id,activeMs};
    });
  },
  async claimRun({now=Date.now(),owner=uuid(),leaseMs=ANALYSIS_LEASE_MS,force=false}) {
    return mutate([STORE.RUNS],async(tx,c)=>{
      if(!c.enabled)return null;
      const runs=await tx.indexed(STORE.RUNS,'configGeneration',c.configGeneration);
      let run=runs.find(r=>['running','waiting_retry','queued'].includes(r.status));
      if(run && ((run.leaseToken&&run.leaseExpiresAt>now)||(run.retryAt&&run.retryAt>now)))return null;
      if(!run){
        if(!force && c.nextDueAt>now)return null;
        run={id:uuid(),generation:c.generation,configGeneration:c.configGeneration,policyRevision:c.policyRevision,config:publicConfig(c),cutoff:now,status:'running',cursor:0,createdAt:now};run.runId=run.id;
        const origin=c.budgetOrigin??now;c.nextDueAt=origin+(Math.floor((now-origin)/ANALYSIS_DAY_MS)+1)*ANALYSIS_DAY_MS;await tx.put(STORE.STATE,c);
      }
      run.owner=owner;run.leaseToken=uuid();run.leaseExpiresAt=now+leaseMs;run.status='running';run.retryAt=null;await charge(tx,c,{id:run.id});await tx.put(STORE.RUNS,run);return run;
    });
  },
  async renewRunLease(ref){return mutate([STORE.RUNS],async(tx,c)=>{const r=await checkRun(tx,c,ref);r.leaseExpiresAt=ref.now+ref.leaseMs;await tx.put(STORE.RUNS,r);return {expiresAt:r.leaseExpiresAt};});},
  async getRun({runId}){return idbReq(STORE.RUNS,'readonly',s=>s.get(runId));},
  async selectRunBatch(ref){
    return mutate([STORE.RUNS,STORE.CHUNKS,STORE.VIDEOS,STORE.EVIDENCE,STORE.COVERAGE,STORE.CLASSIFICATIONS],async(tx,c)=>{
      const r=await checkRun(tx,c,ref);if(r.batch)return r.batch;
      const skipped=new Set(r.skippedChunkIds??[]);
      const chunks=(await tx.indexed(STORE.CHUNKS,'policyRevision',r.policyRevision)).filter(x=>(x.endedAt??x.acceptedAt)<=r.cutoff&&x.activeMs>0&&!skipped.has(x.id));
      const covered=new Set((await tx.indexed(STORE.COVERAGE,'policyRevision',r.policyRevision)).map(x=>x.chunkId));
      const videos=[],selected=[];
      for(const candidate of chunks.filter(x=>!covered.has(x.id)&&x.evidenceVersion)){
        const videoId=candidate.videoId, version=candidate.evidenceVersion;
        if(videos.some(v=>v.videoId===videoId))continue;
        const e=await tx.get(STORE.EVIDENCE,videoId+':'+version);
        if(!e||!(e.durationSeconds>ANALYSIS_MIN_DURATION_SECONDS))continue;
        const pending=chunks.filter(x=>x.videoId===videoId&&x.evidenceVersion===version&&!covered.has(x.id));
        const classified=await tx.indexed(STORE.CLASSIFICATIONS,'videoId_evidenceVersion',[videoId,e.evidenceVersion]);
        const blocked=new Set(classified.filter(x=>x.verdict==='uncertain').flatMap(x=>x.chunkIds));
        const ready=pending.filter(x=>!blocked.has(x.id));if(!ready.length)continue;
        videos.push(e);selected.push(...ready);if(videos.length>=Math.min(ref.maxVideos??10,10))break;
      }
      r.batch={batchId:uuid(),videos,chunks:selected,nextCursor:r.cursor+videos.length};await charge(tx,c,r.batch);await tx.put(STORE.RUNS,r);return r.batch;
    });
  },
  async savePreparedParts(ref){return mutate([STORE.RUNS,STORE.INPUTS],async(tx,c)=>{await checkRun(tx,c,ref);const ids=[];for(const part of ref.parts){const id=ref.runId+':'+part.videoId+':'+part.part;if(!await tx.get(STORE.INPUTS,id)){const row={...part,id,runId:ref.runId,batchId:ref.batchId,createdAt:Date.now()};await charge(tx,c,row);await tx.put(STORE.INPUTS,row);}ids.push(id);}return {partIds:ids};});},
  async getPreparedParts({runId}){return (await idbReq(STORE.INPUTS,'readonly',s=>s.getAll())).filter(x=>x.runId===runId);},
  async advanceBatch(ref){return mutate([STORE.RUNS],async(tx,c)=>{const r=await checkRun(tx,c,ref);r.cursor=r.batch?.nextCursor??r.cursor;r.skippedChunkIds=[...new Set([...(r.skippedChunkIds??[]),...(r.batch?.chunks??[]).map(x=>x.id)])];r.batch=null;await tx.put(STORE.RUNS,r);});},
  async getPendingWakeAt(){return mutate([STORE.RUNS],async(tx,c)=>{const rows=(await tx.indexed(STORE.RUNS,'configGeneration',c.configGeneration)).filter(r=>['running','waiting_retry','queued'].includes(r.status));return rows.length?Math.min(...rows.map(r=>r.retryAt||r.leaseExpiresAt||Date.now())):null;});},
  async beginAttempt(ref){
    return mutate([STORE.RUNS,STORE.INPUTS,STORE.BUDGETS],async(tx,c)=>{
      const r=await checkRun(tx,c,ref),part=await tx.get(STORE.INPUTS,ref.partId);assert(part&&part.runId===r.id);
      const now=ref.now??Date.now(),origin=c.budgetOrigin??now,window=origin+Math.floor((now-origin)/ANALYSIS_DAY_MS)*ANALYSIS_DAY_MS,id=String(window);
      const budget=await tx.get(STORE.BUDGETS,id)||{id,requests:0,bytes:0};
      assert(budget.requests<c.maxRequestsPer24h&&budget.bytes+ref.inputBytes<=c.maxInputBytesPer24h,'BUDGET_EXHAUSTED');
      budget.requests++;budget.bytes+=ref.inputBytes;await tx.put(STORE.BUDGETS,budget);
      const attempt={id:uuid(),partId:ref.partId,createdAt:now,status:'indeterminate'};part.attempts??=[];part.attempts.push(attempt);await charge(tx,c,attempt);await tx.put(STORE.INPUTS,part);return {attemptId:attempt.id};
    });
  },
  async finishAttempt(ref){return mutate([STORE.RUNS,STORE.INPUTS],async(tx,c)=>{await checkRun(tx,c,ref);const parts=await tx.all(STORE.INPUTS),p=parts.find(x=>x.attempts?.some(a=>a.id===ref.attemptId));assert(p);const a=p.attempts.find(x=>x.id===ref.attemptId);Object.assign(a,ref.outcome);if(ref.outcome.status==='success')p.result=ref.outcome.result;await tx.put(STORE.INPUTS,p);});},
  async commitVideoResult(ref){
    return mutate([STORE.RUNS,STORE.CLASSIFICATIONS,STORE.COVERAGE,STORE.CHUNKS,STORE.OWNERSHIP],async(tx,c)=>{
      const r=await checkRun(tx,c,ref),e=r.batch?.videos.find(v=>v.videoId===ref.videoId);assert(e);
      const id=r.id+':'+ref.videoId;if(await tx.get(STORE.CLASSIFICATIONS,id))return;
      const row={id,runId:r.id,videoId:ref.videoId,evidenceVersion:e.evidenceVersion,channelId:e.channelId,policyRevision:r.policyRevision,createdAt:Date.now(),...ref.result,chunkIds:ref.chunkIds};await charge(tx,c,row);await tx.put(STORE.CLASSIFICATIONS,row);
      if(row.verdict!=='uncertain')for(const chunkId of ref.chunkIds){const chunk=await tx.get(STORE.CHUNKS,chunkId);assert(chunk&&chunk.policyRevision===r.policyRevision);const ownership=await tx.get(STORE.OWNERSHIP,e.channelId||'unknown');const resetAt=ownership?.resetAt??0;
        const counted=chunk.activeIntervals.reduce((n,i)=>n+Math.max(0,i.wallEndMs-Math.max(resetAt,i.wallStartMs)),0);
        const key=r.policyRevision+':'+chunkId;if(!await tx.get(STORE.COVERAGE,key))await tx.put(STORE.COVERAGE,{id:key,chunkId,classificationId:id,channelId:e.channelId,policyRevision:r.policyRevision,verdict:row.verdict,countedMs:row.verdict==='irrelevant'?counted:0,endedAt:chunk.endedAt});}
    });
  },
  async getChannelAccounting({policyRevision,channelId}){
    return mutate([STORE.COVERAGE,STORE.OWNERSHIP],async(tx)=>{const o=await tx.get(STORE.OWNERSHIP,channelId),resetAt=o?.resetAt??0;const rows=(await tx.indexed(STORE.COVERAGE,'policyRevision_channelId',[policyRevision,channelId])).filter(x=>x.endedAt>resetAt);return {irrelevantMs:rows.reduce((n,x)=>n+x.countedMs,0),resetAt,coveredChunkIds:rows.map(x=>x.chunkId)};});
  },
  async planBlock(ref){
    return mutate([STORE.RUNS,STORE.COVERAGE,STORE.OWNERSHIP,STORE.OUTBOX,STORE.DECISIONS],async(tx,c)=>{
      const r=await checkRun(tx,c,ref);if(!CANONICAL_CHANNEL_PATTERN.test(ref.channelId))return null;
      const o=await tx.get(STORE.OWNERSHIP,ref.channelId)||{id:ref.channelId,aliases:[],manual:false,automatic:[],generation:0,resetAt:0};
      if(o.manual||o.automatic.length)return null;
      const rows=(await tx.indexed(STORE.COVERAGE,'policyRevision_channelId',[r.policyRevision,ref.channelId])).filter(x=>x.endedAt>o.resetAt);
      const ms=rows.reduce((n,x)=>n+x.countedMs,0);if(ms<=ANALYSIS_THRESHOLD_MS)return null;
      const e=r.batch?.videos.find(v=>v.channelId===ref.channelId);o.aliases=[...new Set([...o.aliases,...(e?.channelAliases??[])])];
      const d={id:uuid(),runId:r.id,channelId:ref.channelId,policyRevision:r.policyRevision,createdAt:Date.now(),countedMs:ms,thresholdMs:ANALYSIS_THRESHOLD_MS,chunkIds:rows.map(x=>x.chunkId),action:'block',status:'pending',generation:c.generation,configGeneration:c.configGeneration,ownershipGeneration:o.generation};
      o.automatic=[d.id];await charge(tx,c,d);await tx.put(STORE.DECISIONS,d);await tx.put(STORE.OUTBOX,{...d,ids:[ref.channelId,...o.aliases]});await tx.put(STORE.OWNERSHIP,o);return d;
    });
  },
  async finishRun(ref){return mutate([STORE.RUNS],async(tx,c)=>{const r=await checkRun(tx,c,ref);r.status=ref.status;r.retryAt=ref.retryAt??null;r.leaseToken=null;r.leaseExpiresAt=0;if(ref.status==='completed'||ref.status==='completed_with_errors')r.batch=null;await tx.put(STORE.RUNS,r);if(ref.nextDueAt!=null){c.nextDueAt=ref.nextDueAt;await tx.put(STORE.STATE,c);}});},
  // administrative close-out for a run orphaned by STALE_GENERATION/LEASE_LOST: checkRun would
  // reject a normal finishRun on such a run (that's precisely why it would otherwise be left
  // stuck 'running' forever), so this bypasses the generation/lease guard deliberately.
  async cancelRun({runId}){return mutate([STORE.RUNS],async(tx)=>{const r=await tx.get(STORE.RUNS,runId);if(!r||!['running','waiting_retry','queued'].includes(r.status))return;r.status='cancelled';r.retryAt=null;r.leaseToken=null;r.leaseExpiresAt=0;r.batch=null;await tx.put(STORE.RUNS,r);});},
  async pruneAging({now=Date.now(),retentionMs=ANALYSIS_RETENTION_MS}={}){
    return mutate([STORE.RUNS,STORE.INPUTS,STORE.CLASSIFICATIONS,STORE.COVERAGE,STORE.CHUNKS,STORE.CAPTURES,STORE.EVIDENCE],async(tx,c)=>{
      const cutoff=now-retentionMs;let prunedCount=0,freedBytes=0;const deadRunIds=new Set();
      const drop=async(store,row)=>{await tx.delete(store,row.id);prunedCount++;freedBytes+=byteLength(row);};
      // never prune rows tagged with the live configGeneration/policyRevision: they still feed
      // getChannelAccounting/planBlock's lifetime-to-date accounting for the active channel.
      for(const r of await tx.all(STORE.RUNS)){
        if(['completed','completed_with_errors','cancelled'].includes(r.status)&&r.createdAt<cutoff&&r.configGeneration!==c.configGeneration){
          deadRunIds.add(r.id);await drop(STORE.RUNS,r);
        }
      }
      for(const row of await tx.all(STORE.INPUTS))if(deadRunIds.has(row.runId))await drop(STORE.INPUTS,row);
      const belowCurrentRevision=IDBKeyRange.upperBound(c.policyRevision,true);
      for(const row of await tx.indexed(STORE.COVERAGE,'policyRevision',belowCurrentRevision))if((row.endedAt??0)<cutoff)await drop(STORE.COVERAGE,row);
      for(const row of await tx.indexed(STORE.CLASSIFICATIONS,'policyRevision',belowCurrentRevision))if(row.createdAt<cutoff)await drop(STORE.CLASSIFICATIONS,row);
      for(const row of await tx.indexed(STORE.CHUNKS,'policyRevision',belowCurrentRevision))if((row.endedAt??row.acceptedAt??0)<cutoff)await drop(STORE.CHUNKS,row);
      for(const row of await tx.all(STORE.CAPTURES))if(row.policyRevision!==c.policyRevision&&row.createdAt<cutoff)await drop(STORE.CAPTURES,row);
      const live=new Set();
      for(const row of await tx.all(STORE.CAPTURES))if(row.evidenceVersion)live.add(row.videoId+':'+row.evidenceVersion);
      for(const row of await tx.all(STORE.CHUNKS))if(row.evidenceVersion)live.add(row.videoId+':'+row.evidenceVersion);
      for(const row of await tx.all(STORE.EVIDENCE))if(!live.has(row.id))await drop(STORE.EVIDENCE,row);
      if(freedBytes>0){c.storageBytes=Math.max(0,c.storageBytes-freedBytes);await tx.put(STORE.STATE,c);}
      return {prunedCount,freedBytes};
    });
  },
  async listHistory(params){const page=await pageStore(STORE.VIDEOS,params);page.items=(await Promise.all(page.items.filter(v=>v.durationSeconds>ANALYSIS_MIN_DURATION_SECONDS&&v.watchMs>0).map(async v=>({...v,...await this.getEvidence(v),watchMs:v.watchMs}))));return page;},
  async getEvidence({videoId,evidenceVersion}){return idbReq(STORE.EVIDENCE,'readonly',s=>s.get(videoId+':'+evidenceVersion));},
  async listAnalysisLog({kind='classification',...params}={}){
    const map={run:STORE.RUNS,classification:STORE.CLASSIFICATIONS,action:STORE.DECISIONS,attempt:STORE.INPUTS};assert(map[kind]);const page=await pageStore(map[kind],params);
    if(kind==='attempt')page.items=page.items.flatMap(p=>(p.attempts??[]).map(a=>({...a,videoId:p.videoId,runId:p.runId})));
    return page;
  },
  async listDecisions(params){return pageStore(STORE.DECISIONS,params);},
  async getOwnership({channelId}){
    return transaction([STORE.OWNERSHIP],'readonly',async tx=>{
      const direct=await tx.get(STORE.OWNERSHIP,channelId);
      if(direct)return direct;
      return (await tx.index(STORE.OWNERSHIP,'aliases',channelId))??undefined;
    });
  },
  async setManualOwnership({channelId,aliases=[],blocked,at=Date.now()}){
    assert(/^UC[\w-]{22}$|^@[\w.-]+$/.test(channelId));
    return mutate([STORE.OWNERSHIP,STORE.OUTBOX],async(tx)=>{const all=await tx.all(STORE.OWNERSHIP);const o=all.find(x=>x.id===channelId||x.aliases?.includes(channelId))||{id:channelId,aliases:[],automatic:[],generation:0,resetAt:0};o.aliases=[...new Set([...o.aliases,...aliases])];o.manual=blocked;if(!blocked){o.automatic=[];o.resetAt=at;o.generation++;for(const entry of await tx.all(STORE.OUTBOX))if(entry.channelId===o.id)await tx.delete(STORE.OUTBOX,entry.id);}await tx.put(STORE.OWNERSHIP,o);return o;});
  },
  async resetChannel({channelId,at}){return this.setManualOwnership({channelId,blocked:false,at});},
  async listOutbox(){return (await idbReq(STORE.OUTBOX,'readonly',s=>s.getAll())).filter(x=>!['applied','cancelled'].includes(x.status));},
  async stageOutbox({decisionId,generation,insertedIds,preexistingIds}){
    return mutate([STORE.OUTBOX],async(tx,c)=>{assert(c.generation===generation,'STALE_GENERATION');const row=await tx.get(STORE.OUTBOX,decisionId);assert(row,'MISSING_OUTBOX');row.status='applying';row.insertedIds=[...new Set(insertedIds)];row.preexistingIds=[...new Set(preexistingIds)];await tx.put(STORE.OUTBOX,row);return row;});
  },
  async cancelOutbox({decisionId,reason='stale'}){
    return mutate([STORE.OUTBOX,STORE.DECISIONS,STORE.OWNERSHIP],async tx=>{const row=await tx.get(STORE.OUTBOX,decisionId);if(!row)return;row.status='cancelled';row.error={code:'CANCELLED',message:reason};await tx.put(STORE.OUTBOX,row);const d=await tx.get(STORE.DECISIONS,decisionId);if(d){d.status='cancelled';d.error=row.error;await tx.put(STORE.DECISIONS,d);}const o=await tx.get(STORE.OWNERSHIP,row.channelId);if(o){o.automatic=(o.automatic??[]).filter(id=>id!==decisionId);await tx.put(STORE.OWNERSHIP,o);}});
  },
  async markOutbox({decisionId,generation,status,error,insertedIds=[],now=Date.now()}){
    return mutate([STORE.OUTBOX,STORE.DECISIONS,STORE.OWNERSHIP,STORE.BLOCKLIST_META],async(tx,c)=>{
      assert(c.generation===generation,'STALE_GENERATION');
      const row=await tx.get(STORE.OUTBOX,decisionId);if(!row)return;
      if(status==='failed'){
        row.failureCount=(row.failureCount??0)+1;
        if(row.failureCount>=OUTBOX_MAX_FAILURES){
          // give up permanently rather than retry forever: clear ownership.automatic (mirrors
          // cancelOutbox) so the channel becomes re-plannable instead of being stuck forever.
          row.status='cancelled';row.retryAt=null;row.error={code:'OUTBOX_EXHAUSTED',message:'Blocking failed repeatedly and was abandoned.'};
          await tx.put(STORE.OUTBOX,row);
          const d=await tx.get(STORE.DECISIONS,decisionId);if(d){d.status='cancelled';d.error=row.error;await tx.put(STORE.DECISIONS,d);}
          const o=await tx.get(STORE.OWNERSHIP,row.channelId);if(o){o.automatic=(o.automatic??[]).filter(id=>id!==decisionId);await tx.put(STORE.OWNERSHIP,o);}
          return;
        }
        row.status='failed';row.error=error;
        row.retryAt=now+Math.min(OUTBOX_RETRY_CAP_MS,OUTBOX_RETRY_BASE_MS*2**(row.failureCount-1));
        await tx.put(STORE.OUTBOX,row);
        const d=await tx.get(STORE.DECISIONS,decisionId);if(d){d.status=status;d.error=error;await tx.put(STORE.DECISIONS,d);}
        return;
      }
      row.status=status;row.error=error;await tx.put(STORE.OUTBOX,row);
      const d=await tx.get(STORE.DECISIONS,decisionId);if(d){d.status=status;d.error=error;await tx.put(STORE.DECISIONS,d);}
      if(status==='applied'){const o=await tx.get(STORE.OWNERSHIP,row.channelId);o.insertedIds=[...new Set([...(o.insertedIds??[]),...insertedIds])];await tx.put(STORE.OWNERSHIP,o);await tx.put(STORE.BLOCKLIST_META,{id:row.channelId,type:'channel',name:row.channelId,blockedAt:Date.now(),source:'automatic'});}
    });
  },
  async listAutomaticBlockIds(){return [...new Set((await idbReq(STORE.OWNERSHIP,'readonly',s=>s.getAll())).filter(o=>!o.manual&&(o.automatic?.length||o.insertedIds?.length)).flatMap(o=>o.insertedIds??[]))];},
  async exportPage({store=STORE.VIDEOS,generation,...params}={}){const c=await this.getConfig();assert(!generation||generation===c.generation,'STALE_GENERATION');const page=await pageStore(store,params);return {...page,generation:c.generation};},
  async deleteFeatureData({generation,removeAutomaticBlocks=false}={}){
    return transaction(featureStores,'readwrite',async tx=>{const c=await configIn(tx);assert(!generation||generation===c.generation,'STALE_GENERATION');const owners=await tx.all(STORE.OWNERSHIP);for(const name of featureStores)await tx.clear(name);c.enabled=false;c.generation=uuid();c.configGeneration++;c.storageBytes=0;await tx.put(STORE.STATE,c);for(const o of owners)if(!removeAutomaticBlocks||o.manual)await tx.put(STORE.OWNERSHIP,{...o,automatic:removeAutomaticBlocks?[]:(o.automatic.length?['retained']:[]),insertedIds:removeAutomaticBlocks?[]:o.insertedIds,generation:o.generation+1});return {generation:c.generation};});
  },
};
