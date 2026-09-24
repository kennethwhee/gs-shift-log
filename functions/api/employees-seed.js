// Retired alternate provisioning endpoint. Use authenticated employee management.
export function onRequest() {
  return Response.json({ ok: false, message: '직원 관리 화면에서 계정을 등록해 주세요.' }, {
    status: 410, headers: { 'Cache-Control': 'no-store' }
  });
}
export const onRequestGet = onRequest;
export const onRequestPost = onRequest;
