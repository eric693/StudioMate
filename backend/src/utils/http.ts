// 業務規則錯誤：丟出後由 app.ts 的錯誤處理回傳對應狀態碼與訊息
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const badRequest = (m: string) => new HttpError(400, m);
export const notFound = (m = '找不到資料') => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);
