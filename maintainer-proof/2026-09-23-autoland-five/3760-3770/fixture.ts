import { v } from "convex/values";
import { internalMutation, internalQuery } from "./functions";
import { hashToken } from "./lib/tokens";

export const seedMetrics = internalMutation({ args: { key:v.string(), kind:v.string() }, handler: async (ctx, {key,kind}) => {
 const owner=await ctx.db.insert("users",{handle:key+"-owner",role:"user"});
 const outsider=await ctx.db.insert("users",{handle:key+"-outsider",role:"user"});
 const publisherId=await ctx.db.insert("publishers",{kind:kind==="org"?"org":"user",handle:key,displayName:key,createdAt:1,updatedAt:1,...(kind==="linked"?{linkedUserId:owner}:{})});
 if(kind!=="org")await ctx.db.patch(owner,{personalPublisherId:publisherId});
 await ctx.db.insert("publisherMembers",{publisherId,userId:owner,role:"owner",createdAt:1,updatedAt:1});
 await ctx.db.insert("skills",{slug:key,displayName:key,ownerUserId:owner,ownerPublisherId:publisherId,tags:{},stats:{comments:0,downloads:37,stars:0,versions:0},createdAt:1,updatedAt:1});
 return {owner,outsider,publisherId,slug:key};
}});
export const seedCatalog = internalMutation({args:{key:v.string(),mode:v.string(),fallback:v.boolean()},handler:async(ctx,{key,mode,fallback})=>{
 const owner=await ctx.db.insert("users",{handle:key+"-owner",role:"admin"});
 const publisherId=await ctx.db.insert("publishers",{kind:"user",handle:key,displayName:key,linkedUserId:owner,createdAt:1,updatedAt:1});
 await ctx.db.insert("officialPublishers",{publisherId,createdAt:1,updatedAt:1});
 await ctx.db.insert("apiTokens",{userId:owner,label:"proof",prefix:"proof",tokenHash:await hashToken("native-proof-"+key),createdAt:Date.now()});
 const packageId=await ctx.db.insert("packages",{name:key,normalizedName:key,displayName:key,ownerUserId:owner,ownerPublisherId:publisherId,family:"code-plugin",channel:"official",isOfficial:true,scanStatus:"clean",tags:{},stats:{downloads:0,installs:0,stars:0,versions:5},createdAt:1,updatedAt:1,...(mode==="restore"?{softDeletedAt:10,softDeletedByRole:"user" as const}:{})});
 const props={packageId,changelog:"proof",distTags:[],files:[],integritySha256:"a".repeat(64),sha256hash:"a".repeat(64),createdBy:owner,verification:{tier:"source-linked" as const,scope:"artifact-only" as const,scanStatus:"clean" as const}};
 const olderId=fallback?await ctx.db.insert("packageReleases",{...props,version:"1.0.0",createdAt:1}):null;
 const withdrawnId=await ctx.db.insert("packageReleases",{...props,version:"3.0.0",createdAt:3,publicationStatus:"published",ownerDeletedAt:0});
 await ctx.db.insert("packageReleases",{...props,version:"4.0.0",createdAt:4,publicationStatus:"blocked"});
 const pendingId=await ctx.db.insert("packageReleases",{...props,version:"5.0.0",createdAt:5,publicationStatus:"pending",distTags:["latest"]});
 const targetId=await ctx.db.insert("packageReleases",{...props,version:"2.0.0",createdAt:2,publicationStatus:"published",...(mode==="restore"?{ownerDeletedAt:0}:{})});
 const latest=mode==="withdrawn"?withdrawnId:mode==="restore"?pendingId:targetId;
 await ctx.db.patch(packageId,{latestReleaseId:latest,tags:{latest},latestVersionSummary:{version:mode==="withdrawn"?"3.0.0":mode==="restore"?"5.0.0":"2.0.0",createdAt:2,changelog:"proof"}});
 return {owner,packageId,targetId,olderId,pendingId,withdrawnId,name:key};
}});
export const removeRelease=internalMutation({args:{releaseId:v.id("packageReleases")},handler:async(ctx,args)=>{await ctx.db.patch(args.releaseId,{softDeletedAt:Date.now()});}});
export const snapshot=internalQuery({args:{packageId:v.id("packages")},handler:async(ctx,args)=>({pkg:await ctx.db.get(args.packageId),releases:await ctx.db.query("packageReleases").withIndex("by_package",q=>q.eq("packageId",args.packageId)).collect()})});
