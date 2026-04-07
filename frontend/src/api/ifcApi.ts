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
  fragDownloadUrls?: string[];
  manifestUrl?: string;
  totalChunks?: number;
  message: string;
  progressPercent?: number;
}

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
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(formData);
  });
}

export async function requestConversion(fileId: string): Promise<ConversionStatusResponse> {
  const res = await fetch(`${API_BASE}/${fileId}/convert`, { method: "POST" });
  if (!res.ok) throw new Error(`Conversion request failed: ${res.status}`);
  return res.json();
}

export async function getConversionStatus(fileId: string): Promise<ConversionStatusResponse> {
  const res = await fetch(`${API_BASE}/${fileId}/status`);
  if (!res.ok) throw new Error(`Status request failed: ${res.status}`);
  return res.json();
}

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
  return {
    cancel: () => {
      cancelled = true;
    },
  };
}

export async function downloadFragAsBuffer(fileId: string): Promise<ArrayBuffer> {
  const res = await fetch(`${API_BASE}/${fileId}/frag`);

  if (!res.ok) {
    const text = await res.text();
    console.log("downloadFragAsBuffer error body =", text);
    throw new Error(`frag download failed: ${res.status}`);
  }

  return res.arrayBuffer();
}

export async function downloadChunkFragAsBuffer(
  fileId: string,
  chunkIndex: number
): Promise<ArrayBuffer> {
  const res = await fetch(`${API_BASE}/${fileId}/frag/${chunkIndex}`);
  if (!res.ok) {
    throw new Error(`frag chunk ${chunkIndex} download failed: ${res.status}`);
  }
  return res.arrayBuffer();
}

export async function downloadAllChunks(
  fileId: string,
  totalChunks: number,
  onChunkLoaded?: (index: number, total: number, buffer: ArrayBuffer) => void
): Promise<ArrayBuffer[]> {
  const buffers: ArrayBuffer[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const buffer = totalChunks === 1
      ? await downloadFragAsBuffer(fileId)
      : await downloadChunkFragAsBuffer(fileId, i);
    buffers.push(buffer);
    onChunkLoaded?.(i, totalChunks, buffer);
  }

  return buffers;
}
