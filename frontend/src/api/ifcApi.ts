/**
 * IFC 업로드/변환/다운로드 API 클라이언트
 *
 *  file.arrayBuffer() 로 IFC 전체를 브라우저 메모리에 올리지 않음
 *  FormData로 서버에 업로드만 하고, 변환된 .frag만 받아서 뷰어에 로드
 */

const API_BASE = "http://localhost:8080/api/ifc";

export interface UploadResponse {
  fileId: string;
  originalName: string;
  fileSize: number;
  status: string;
  message: string;
}

export interface ConversionStatusResponse {
  fileId: string;
  status: "UPLOADED" | "CONVERTING" | "COMPLETED" | "FAILED";
  fragDownloadUrl?: string;
  fragDownloadUrls?: string[];  // 분할 변환 시 여러 .frag URL
  message: string;
  progressPercent?: number;
}

/**
 * IFC 파일을 Spring Boot 서버에 업로드
 * FormData + File 조합은 브라우저가 내부적으로 스트리밍 전송
 */
export async function uploadIfcFile(
  file: File,
  onProgress?: (percent: number) => void
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/upload`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`업로드 실패: ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error("네트워크 오류"));
    xhr.send(formData);
  });
}

export async function requestConversion(fileId: string): Promise<ConversionStatusResponse> {
  const res = await fetch(`${API_BASE}/${fileId}/convert`, { method: "POST" });
  if (!res.ok) throw new Error(`변환 요청 실패: ${res.status}`);
  return res.json();
}

export async function getConversionStatus(fileId: string): Promise<ConversionStatusResponse> {
  const res = await fetch(`${API_BASE}/${fileId}/status`);
  if (!res.ok) throw new Error(`상태 조회 실패: ${res.status}`);
  return res.json();
}

/**
 * 변환 완료까지 폴링 (3초 간격)
 */
export function pollUntilComplete(
  fileId: string,
  onStatus: (status: ConversionStatusResponse) => void,
  intervalMs = 3000
): { cancel: () => void } {
  let cancelled = false;

  const poll = async () => {
    while (!cancelled) {
      const status = await getConversionStatus(fileId);
      onStatus(status);
      if (status.status === "COMPLETED" || status.status === "FAILED") break;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };

  poll().catch(console.error);
  return { cancel: () => { cancelled = true; } };
}

/**
 * .frag 파일을 ArrayBuffer로 다운로드.
 * .frag는 원본 IFC 대비 훨씬 작으므로 브라우저에서 안전하게 처리 가능.
 */
export async function downloadFragAsBuffer(fileId: string): Promise<ArrayBuffer> {
  const res = await fetch(`${API_BASE}/${fileId}/frag`);

  console.log("content-type =", res.headers.get("content-type"));
  console.log("content-length =", res.headers.get("content-length"));
  console.log("status =", res.status);

  if (!res.ok) {
    const text = await res.text();
    console.log("error body =", text);
    throw new Error(`frag 다운로드 실패: ${res.status}`);
  }

  const fragBuffer = await res.arrayBuffer();
  const head = Array.from(new Uint8Array(fragBuffer.slice(0, 16)));

  console.log("fragBuffer.byteLength =", fragBuffer.byteLength);
  console.log("first 16 bytes =", head);

  return fragBuffer;
}

/**
 * 분할 변환 시 특정 청크의 .frag 파일을 다운로드.
 */
export async function downloadChunkFragAsBuffer(
  fileId: string,
  chunkIndex: number
): Promise<ArrayBuffer> {
  const res = await fetch(`${API_BASE}/${fileId}/frag/${chunkIndex}`);
  if (!res.ok) throw new Error(`.frag 청크 ${chunkIndex} 다운로드 실패: ${res.status}`);
  return res.arrayBuffer();
}

/**
 * 분할 변환 결과의 모든 .frag 청크를 순차 다운로드.
 * 각 청크 다운로드 완료 시 onChunkLoaded 콜백 호출.
 */
export async function downloadAllChunks(
  fileId: string,
  totalChunks: number,
  onChunkLoaded?: (index: number, total: number, buffer: ArrayBuffer) => void
): Promise<ArrayBuffer[]> {
  const buffers: ArrayBuffer[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const buffer = await downloadChunkFragAsBuffer(fileId, i);
    buffers.push(buffer);
    onChunkLoaded?.(i, totalChunks, buffer);
  }

  return buffers;
}
