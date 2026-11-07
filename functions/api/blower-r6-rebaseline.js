import {getAuthenticatedUser} from './blower-history.js';
import {r6Status,r6Begin,r6Advance,r6Apply,r6Cancel} from '../_shared/blower-r6-rebaseline.js';
const response=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const problem=error=>response({ok:false,code:error?.code||'R6_ERROR',message:error?.code?error.message:'R6 처리를 완료하지 못했습니다. 기존 누적시간을 유지했습니다.'},error?.status||409);
export async function onRequestGet(context){
  try{
    const auth=await getAuthenticatedUser(context);if(auth.error)return auth.error;
    const id=new URL(context.request.url).searchParams.get('id')||'';
    return response(await r6Status(context.env.DB,auth.user,id));
  }catch(e){return problem(e)}
}
export async function onRequestPost(context){
  try{
    const auth=await getAuthenticatedUser(context);if(auth.error)return auth.error;
    if(Number(context.request.headers.get('content-length')||0)>3000)return response({ok:false,message:'요청 크기가 너무 큽니다.'},413);
    const body=await context.request.json();
    if(!body||typeof body!=='object'||Array.isArray(body))return response({ok:false,message:'요청 형식이 잘못됐습니다.'},400);
    const db=context.env.DB,user=auth.user;
    if(body.action==='begin')return response(await r6Begin(db,user));
    if(body.action==='advance')return response(await r6Advance(db,user,body.id));
    if(body.action==='approve')return response(await r6Apply(db,user,body.id,body.confirmation,body.note));
    if(body.action==='cancel')return response(await r6Cancel(db,user,body.id));
    return response({ok:false,message:'지원하지 않는 R6 작업입니다.'},400);
  }catch(e){return problem(e)}
}
