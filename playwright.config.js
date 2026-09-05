import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'src/__tests__/e2e',timeout:60000,workers:1,reporter:'list',use:{trace:'retain-on-failure'}});
