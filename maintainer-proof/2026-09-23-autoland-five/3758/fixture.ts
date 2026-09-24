import { v } from 'convex/values';
import { internalMutation, internalQuery } from './functions';
import { hashToken } from './lib/tokens';

export const seed = internalMutation({args: {},handler: async ctx => {
  const historical = await ctx.db.insert('users', {handle:'native-http-historical',role:'user'});
  const current = await ctx.db.insert('users', {handle:'native-http-current',role:'user'});
  for (const [userId, token] of [[historical, 'native-historical-fixture'],[current, 'native-current-fixture']] as const) {
    await ctx.db.insert('apiTokens', {userId,label:'local fixture',prefix:'fixture',tokenHash:await hashToken(token),createdAt:Date.now()});
  }
  const org = await ctx.db.insert('publishers', {kind:'org',handle:'native-fixture-org',displayName:'Native fixture org',createdAt:1,updatedAt:1});
  const personal = await ctx.db.insert('publishers', {kind:'user',handle:'native-fixture-personal',displayName:'Native fixture personal',linkedUserId:historical,createdAt:1,updatedAt:1});
  const unlinked = await ctx.db.insert('publishers', {kind:'user',handle:'native-fixture-unlinked',displayName:'Native fixture unlinked',createdAt:1,updatedAt:1});
  for(const [name,publisherId] of [['org',org],['personal',personal],['unlinked',unlinked],['legacy',undefined]] as const) {
    await ctx.db.insert('skills', {
      slug:`native-owner-${name}`,displayName:`Native owner ${name}`,ownerUserId:historical,
      ...(publisherId?{ownerPublisherId:publisherId}:{}),tags:{},badges:{},
      moderationStatus:'hidden',moderationReason:'pending.scan',moderationVerdict:'suspicious',
      moderationEvidence:[{code:'suspicious.dynamic_code_execution',severity:'critical',file:'index.ts',line:3,message:'Synthetic fixture finding',evidence:'private-native-fixture-evidence'}],
      stats:{comments:0,downloads:0,stars:0,versions:0},createdAt:1,updatedAt:1,
    });
  }
  return {historical,current,org,personal};
}});

export const membership = internalMutation({args:{publisherId:v.id('publishers'),userId:v.id('users'),present:v.boolean()},handler:async(ctx,args)=>{
  const existing=await ctx.db.query('publisherMembers').withIndex('by_publisher_user',q=>q.eq('publisherId',args.publisherId).eq('userId',args.userId)).unique();
  if(existing&&!args.present)await ctx.db.delete(existing._id);
  if(!existing&&args.present)await ctx.db.insert('publisherMembers',{publisherId:args.publisherId,userId:args.userId,role:'publisher',createdAt:1,updatedAt:1});
  return await ctx.db.query('publisherMembers').withIndex('by_publisher_user',q=>q.eq('publisherId',args.publisherId).eq('userId',args.userId)).unique();
}});

export const link = internalMutation({args:{publisherId:v.id('publishers'),userId:v.id('users')},handler:async(ctx,args)=>{
  await ctx.db.patch(args.publisherId,{linkedUserId:args.userId});
  return await ctx.db.get(args.publisherId);
}});

export const snapshot = internalQuery({args:{},handler:async ctx=>({
  skills:(await ctx.db.query('skills').collect()).filter(s=>s.slug.startsWith('native-owner-')).map(s=>({_id:s._id,slug:s.slug,ownerUserId:s.ownerUserId,ownerPublisherId:s.ownerPublisherId,moderationStatus:s.moderationStatus,moderationReason:s.moderationReason})),
  publishers:await ctx.db.query('publishers').collect(),memberships:await ctx.db.query('publisherMembers').collect(),
  scheduled:await ctx.db.system.query('_scheduled_functions').collect(),
})});
