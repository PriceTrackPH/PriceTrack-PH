type RoutedBody = {platform?: string;shopId?: string;productId?: string;[key:string]:unknown};
type Context = {url:string;secret:string;token:string};
export async function forwardOwnedRecording(request:Request,body:RoutedBody,context:Context,fetcher:typeof fetch=fetch) {
  const headers={apikey:context.secret,...(context.secret.startsWith("ey")?{Authorization:`Bearer ${context.secret}`}:{})};
  const control=await fetcher(`${context.url}/rest/v1/site_settings?key=eq.database_routing_live&select=boolean_value&limit=1`,{headers});
  if(!control.ok)throw Error("Unable to verify database routing");
  if((await control.json())[0]?.boolean_value!==true)return null;
  const assignment=await fetcher(`${context.url}/rest/v1/rpc/assign_product_database`,{
    method:"POST",headers:{...headers,"content-type":"application/json"},
    body:JSON.stringify({p_platform:body.platform||"shopee",p_shop_id:body.shopId,p_product_id:body.productId}),
  });
  if(!assignment.ok)throw Error("Unable to assign the product database");
  const owner=await assignment.json();
  if(owner==='db1')return null;
  if(typeof owner!=='string'||!/^db[1-9]\d{0,2}$/.test(owner))throw Error("Invalid product database owner");
  const response=await fetcher('https://pricetrackph.com/api/observations',{
    method:"POST",signal:AbortSignal.timeout(50000),
    headers:{"content-type":"application/json","x-pricetrack-owner-token":context.token,
      "user-agent":request.headers.get("user-agent")||"",
      ...(request.headers.get('x-pricetrack-client-id')?{'x-pricetrack-client-id':request.headers.get('x-pricetrack-client-id')!}:{}),
      ...(request.headers.get('x-pricetrack-internal-token')?{'x-pricetrack-internal-token':request.headers.get('x-pricetrack-internal-token')!}:{})},
    body:JSON.stringify(body),
  });
  return {status:response.status,body:await response.json()};
}
