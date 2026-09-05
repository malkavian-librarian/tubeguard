let tail=Promise.resolve();
export function serializeMutation(work){
  const result=tail.then(work);tail=result.catch(()=>{});return result;
}
