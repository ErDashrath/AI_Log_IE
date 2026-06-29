export interface ApiResponse<T> {
  success: boolean;
  message: string;
  processingTimeMs: number;
  data: T | null;
  fallback?: boolean;
}
