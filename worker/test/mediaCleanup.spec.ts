import { afterEach,describe,expect,it,vi } from "vitest";
import worker,{type Env} from "../src/index";
import { finishMediaJob,handleAdminMediaCleanup } from "../src/mediaCleanup";
const IncomingRequest=Request<unknown,IncomingRequestCfProperties>;
const user="fa100000-0000-4000-8000-000000000001";
const key=`rest/${user}/photo.jpg`;
const lease="fa100000-0000-4000-8000-000000000002";
const job={key,lease_id:lease};
function setup(claimed:unknown=[job],status=200) {
 const bucket={delete:vi.fn().mockResolvedValue(undefined),put:vi.fn().mockResolvedValue({key})};
 const env={SUPABASE_URL:"https://supabase.test",SUPABASE_PUBLISHABLE_KEY:"publishable-test",MEDIA:bucket} as unknown as Env;
 const fetch=vi.fn(async(input:unknown)=>{
  const url=String(input);
  if (url.endsWith("/auth/v1/user")) return Response.json({id:user});
  if (url.endsWith("/finish_media_cleanup")) return new Response(null,{status:204});
  if (url.endsWith("/media_upload_allowed")) return Response.json(true);
  if (url.endsWith("/media_upload_retired")) return Response.json(false);
  return Response.json(claimed,{status});
 });
 vi.stubGlobal("fetch",fetch);
 return {env,bucket,fetch};
}
function request(path="/media/cleanup",method="POST",auth=true,body?:string){
 return new IncomingRequest(`https://worker.test${path}`,{method,headers:{...(auth ? {authorization:"Bearer test"} : {}),"content-type":"image/jpeg","content-length":"4"},...(body ? {body} : {})});
}
afterEach(()=>vi.unstubAllGlobals());
describe("trusted cleanup",()=>{
 it("requires bearer and POST before backend/R2 calls",async()=>{
  const {env,bucket,fetch}=setup();
  expect((await handleAdminMediaCleanup(request(undefined,"POST",false),env)).status).toBe(401);
  expect((await handleAdminMediaCleanup(request(undefined,"GET"),env)).status).toBe(405);
  expect(fetch).not.toHaveBeenCalled(); expect(bucket.delete).not.toHaveBeenCalled();
 });
 it("ordinary users cannot claim the admin queue",async()=>{
  const {env,bucket}=setup({message:"Admin access required"},400);
  expect((await handleAdminMediaCleanup(request(),env)).status).toBe(403);expect(bucket.delete).not.toHaveBeenCalled();
 });
 it("ignores submitted keys and deletes only database-issued jobs",async()=>{
  const {env,bucket,fetch}=setup();
  const response=await worker.fetch(request(undefined,"POST",true,JSON.stringify({keys:["arbitrary"]})),env);
  expect(await response.json()).toEqual({processed:1,failed:0,claimed:1});
  expect(bucket.delete).toHaveBeenCalledWith(key);expect(bucket.delete).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/finish_media_cleanup"),expect.objectContaining({body:JSON.stringify({object_key:key,job_lease:lease})}));
 });
 it("rejects malformed or excessive claims without deleting",async()=>{
  const {env,bucket}=setup(Array.from({length:21},()=>job));
  expect((await handleAdminMediaCleanup(request(),env)).status).toBe(503);
  expect(await finishMediaJob(request(),env,null)).toBe(false);
  expect(await finishMediaJob(request(),env,{key:"outside",lease_id:lease})).toBe(false);expect(bucket.delete).not.toHaveBeenCalled();
 });
 it("R2 failure leaves the lease unacknowledged for retry",async()=>{
  const {env,bucket,fetch}=setup();bucket.delete.mockRejectedValue(new Error("R2 unavailable"));
  expect(await (await handleAdminMediaCleanup(request(),env)).json()).toMatchObject({failed:1,processed:0});
  expect(fetch.mock.calls.some(([url])=>String(url).endsWith("/finish_media_cleanup"))).toBe(false);
 });
 it("foreign images are denied before cleanup RPC",async()=>{
  const {env,bucket,fetch}=setup(job);
  expect((await worker.fetch(request(`/media/rest/${lease}/foreign.jpg`,"DELETE"),env)).status).toBe(401);
  expect(fetch).toHaveBeenCalledTimes(1);expect(bucket.delete).not.toHaveBeenCalled();
 });
 it("referenced owner image is not deleted",async()=>{
  const {env,bucket}=setup({message:"still in use"},400);
  expect((await worker.fetch(request(`/media/${key}`,"DELETE"),env)).status).toBe(409);expect(bucket.delete).not.toHaveBeenCalled();
 });
 it("owner deletion returns a valid bodyless 204; completed deletion is idempotent",async()=>{
  const {env,bucket}=setup(job);
  const response=await worker.fetch(request(`/media/${key}`,"DELETE"),env);
  expect(response.status).toBe(204);expect(await response.text()).toBe("");expect(bucket.delete).toHaveBeenCalledWith(key);
  const done=setup({done:true});
  expect((await worker.fetch(request(`/media/${key}`,"DELETE"),done.env)).status).toBe(204);expect(done.bucket.delete).not.toHaveBeenCalled();
 });
 it("malformed encoded path returns 404",async()=>{
  const {env}=setup();expect((await worker.fetch(request("/media/%ZZ","DELETE"),env)).status).toBe(404);
 });
 it("uploads are write-once and reject tombstones appearing during PUT",async()=>{
  const {env,bucket,fetch}=setup();
  expect((await worker.fetch(request(`/media/${key}`,"PUT",true,"test"),env)).status).toBe(201);
  expect(bucket.put.mock.calls[0][2].onlyIf.get("if-none-match")).toBe("*");
  bucket.put.mockResolvedValueOnce(null as never);
  expect((await worker.fetch(request(`/media/${key}`,"PUT",true,"test"),env)).status).toBe(409);
  fetch.mockImplementation(async input=>String(input).endsWith("/auth/v1/user") ? Response.json({id:user}) : Response.json(true));
  expect((await worker.fetch(request(`/media/${key}`,"PUT",true,"test"),env)).status).toBe(409);
  expect(bucket.delete).toHaveBeenCalledWith(key);
 });
});
