// No service key and no client-supplied admin keys. Postgres authorizes the
// caller, checks references and issues a bounded lease before R2 deletion.
type CleanupEnv={ SUPABASE_URL:string;SUPABASE_PUBLISHABLE_KEY:string;MEDIA:R2Bucket };
type Job={ key:string;lease_id:string;done?:boolean };
export async function mediaRpc(request:Request,env:CleanupEnv,name:string,args:Record<string,unknown>={}) {
 const response=await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`,{
  method:"POST",headers:{ authorization:request.headers.get("authorization") ?? "",apikey:env.SUPABASE_PUBLISHABLE_KEY,"content-type":"application/json" },body:JSON.stringify(args),
 });
 if (!response.ok) return { ok:false,status:response.status,data:null };
 const body=await response.text();
 return { ok:true,status:response.status,data:body ? JSON.parse(body) : null };
}
const KEY=/^(rest|rev|usr|post)\/[0-9a-fA-F-]{36}\/[a-zA-Z0-9._-]+\.(jpg|png|webp)$/;
const UUID=/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export async function finishMediaJob(request:Request,env:CleanupEnv,job:Job|null):Promise<boolean> {
 if (!job || typeof job.key!=="string" || typeof job.lease_id!=="string" || !KEY.test(job.key) || !UUID.test(job.lease_id)) return false;
 try {
  await env.MEDIA.delete(job.key);
  const ack=await mediaRpc(request,env,"finish_media_cleanup",{ object_key:job.key,job_lease:job.lease_id });
  return ack.ok;
 } catch { return false; } // Lease expiry permits an idempotent retry.
}
export async function handleAdminMediaCleanup(request:Request,env:CleanupEnv):Promise<Response> {
 if (request.method!=="POST") return new Response(null,{ status:405,headers:{ Allow:"POST" } });
 if (!request.headers.get("authorization")?.startsWith("Bearer ")) return new Response(null,{ status:401 });
 const claimed=await mediaRpc(request,env,"claim_admin_media_cleanup");
 if (!claimed.ok) return new Response(null,{ status:claimed.status>=500 ? 503 : 403 });
 if (!Array.isArray(claimed.data) || claimed.data.length>20) return new Response(null,{ status:503 });
 let processed=0;let failed=0;
 for (const job of claimed.data as Job[]) { if (await finishMediaJob(request,env,job)) processed++; else failed++; }
 return Response.json({ processed,failed,claimed:claimed.data.length });
}
