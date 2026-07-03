import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";
import type { SerializedError } from "@reduxjs/toolkit";
import type { ApiError } from "@/types";

/** Extracts the backend error envelope's message; falls back to a generic line. */
export function apiErrorMessage(
  error: FetchBaseQueryError | SerializedError | undefined,
): string {
  if (!error) return "Beklenmeyen bir hata oluştu.";
  if ("data" in error && error.data && typeof error.data === "object") {
    const envelope = error.data as Partial<ApiError>;
    if (envelope.error?.message) return envelope.error.message;
  }
  if ("status" in error) {
    if (error.status === "FETCH_ERROR") return "Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.";
    return `İstek başarısız oldu (${String(error.status)}).`;
  }
  return error.message ?? "Beklenmeyen bir hata oluştu.";
}
