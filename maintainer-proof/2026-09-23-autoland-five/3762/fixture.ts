import { v } from 'convex/values';
import { internalMutation, internalQuery } from './functions';
import { NVIDIA_SKILL_EVALUATION_CONFIG as config, NVIDIA_SKILL_EVALUATION_CONFIG_KEY } from './lib/skillEvaluationConfig';

export const seed = internalMutation({args: {},handler: async ctx => {
  const member = await ctx.db.insert('users', {handle:'native-evaluation-member',role:'user'});
  const admin = await ctx.db.insert('users', {handle:'native-evaluation-admin',role:'admin'});
  const skillId = await ctx.db.insert('skills',{slug:'doca-dpa',displayName:'doca-dpa',ownerUserId:member,tags:{},stats:{comments:0,downloads:0,stars:0,versions:0},createdAt:1,updatedAt:1});
  const runId = await ctx.db.insert('skillEvaluationRuns',{
    skillId,sourceRepo:config.sourceRepo,sourceCommit:'a'.repeat(40),sourcePath:'skills/doca-dpa',contentHash:'native-auth-fixture',scanStatus:'clean',configKey:NVIDIA_SKILL_EVALUATION_CONFIG_KEY,
    evaluatorRepository:config.evaluatorRepository,evaluatorRelease:config.evaluatorRelease,evaluatorCommit:config.evaluatorCommit,agent:config.agent,agentModel:config.agentModel,judgeProvider:config.judgeProvider,judgeModel:config.judgeModel,environment:config.environment,attemptsPerCase:config.attemptsPerCase,
    status:'skipped',skipReason:'stale-version',source:'backfill',nextRunAt:1234,attempts:0,createdAt:1,updatedAt:1,completedAt:2,
  });
  const leaseExpiresAt=Date.now()+24*60*60*1000;
  const dispatchId=await ctx.db.insert('securityScanDispatchState',{key:'skill-evaluation-worker',leaseToken:'native-proof-owned-future-lease',leaseExpiresAt,updatedAt:1});
  return {member,admin,runId,dispatchId,leaseExpiresAt};
}});
export const snapshot = internalQuery({args:{runId:v.id('skillEvaluationRuns')},handler:async(ctx,args)=>({row:await ctx.db.get(args.runId),dispatch:await ctx.db.query('securityScanDispatchState').collect(),scheduled:await ctx.db.system.query('_scheduled_functions').collect()})});
export const reset = internalMutation({args:{runId:v.id('skillEvaluationRuns'),dispatchId:v.id('securityScanDispatchState')},handler:async(ctx,args)=>{
  const scheduled=await ctx.db.system.query('_scheduled_functions').collect();let cancelled=0;
  for(const job of scheduled)if(job.state.kind==='pending'){await ctx.scheduler.cancel(job._id);cancelled++;}
  await ctx.db.patch(args.runId,{status:'skipped',skipReason:'stale-version',completedAt:2,nextRunAt:1234,updatedAt:1});
  await ctx.db.patch(args.dispatchId,{scheduledToken:undefined,scheduledAt:undefined,updatedAt:1});
  return {cancelled};
}});
