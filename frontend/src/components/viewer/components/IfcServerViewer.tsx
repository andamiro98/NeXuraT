import { useEffect, useRef, useState, useCallback } from "react";
import * as OBC from "@thatopen/components";
import {
  uploadIfcFile,
  requestConversion,
  pollUntilComplete,
  downloadFragAsBuffer,
  type ConversionStatusResponse,
} from "../../../api/ifcApi";

/**
 * 서버 변환 방식 IFC 뷰어
 *
 * 핵심 원칙:
 *   file.arrayBuffer() 로 IFC 전체를 브라우저 메모리에 올리지 않음
 *   ifcLoader.load() 로 브라우저에서 IFC를 직접 파싱하지 않음
 *   FormData로 Spring Boot 서버에 업로드만 함
 *   서버에서 Node.js로 변환된 .frag 파일만 받아서 뷰어에 로드
 *
 * 대용량 IFC (4.99GB+) 에서도 NotReadableError 없이 동작한다.
 */

type IfcServerViewerProps = {
  height?: number | string;
};

export default function IfcServerViewer({ height = "100vh" }: IfcServerViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const componentsRef = useRef<OBC.Components | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [status, setStatus] = useState("대기 중");
  const [phase, setPhase] = useState<
    "idle" | "uploading" | "converting" | "downloading" | "loading" | "done" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  // === 뷰어 초기화 ===
  useEffect(() => {
    if (!containerRef.current) return;

    const components = new OBC.Components();
    componentsRef.current = components;

    const worlds = components.get(OBC.Worlds);
    const world = worlds.create<
      OBC.SimpleScene,
      OBC.OrthoPerspectiveCamera,
      OBC.SimpleRenderer
    >();

    world.scene = new OBC.SimpleScene(components);
    world.scene.setup();
    world.scene.three.background = null;

    world.renderer = new OBC.SimpleRenderer(components, containerRef.current);
    world.camera = new OBC.OrthoPerspectiveCamera(components);

    world.camera.controls.setLookAt(12, 12, 12, 0, 0, 0);

    components.init();

    const fragments = components.get(OBC.FragmentsManager);

    const workerUrl = new URL("./thatopen/worker.mjs", window.location.href).toString();
    fragments.init(workerUrl);

    world.camera.controls.addEventListener("update", () => {
      fragments.core.update();
    });

    fragments.list.onItemSet.add(({ value: model }: any) => {
      model.useCamera(world.camera.three);
      world.scene.three.add(model.object);
      fragments.core.update(true);
    });

    return () => {
      components.dispose();
    };
  }, []);

  // === 파일 선택 ===
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.name.toLowerCase().endsWith(".ifc")) {
        setError("IFC 파일만 업로드할 수 있습니다.");
        return;
      }

      setSelectedFile(file);
      setError(null);
      setPhase("idle");
      setStatus(`파일 선택됨: ${file.name} (${formatSize(file.size)})`);
    },
    []
  );

  // === 전체 플로우: 업로드 → 변환 → 다운로드 → 로드 ===
  const handleUploadAndConvert = useCallback(async () => {
    if (!selectedFile || !componentsRef.current) return;

    setError(null);

    try {
      // 1. 업로드
      setPhase("uploading");
      setStatus("서버에 업로드 중...");
      const uploadResult = await uploadIfcFile(selectedFile, (percent) => {
        setUploadProgress(percent);
        setStatus(`업로드 중... ${percent}%`);
      });

      // 2. 변환 요청
      setPhase("converting");
      setStatus("서버에서 IFC → .frag 변환 요청 중...");
      await requestConversion(uploadResult.fileId);

      // 3. 폴링
      setStatus("서버에서 변환 중...");
      await new Promise<void>((resolve, reject) => {
        pollUntilComplete(uploadResult.fileId, (convStatus: ConversionStatusResponse) => {
          if (convStatus.progressPercent) {
            setStatus(`변환 중... ${convStatus.progressPercent}%`);
          }
          if (convStatus.status === "COMPLETED") resolve();
          else if (convStatus.status === "FAILED")
            reject(new Error(convStatus.message || "변환 실패"));
        });
      });

      // 4. .frag 다운로드
      setPhase("downloading");
      setStatus(".frag 파일 다운로드 중...");
      const fragBuffer = await downloadFragAsBuffer(uploadResult.fileId);

      // 5. 뷰어에 로드
      setPhase("loading");
      setStatus("3D 모델 로딩 중...");

      const components = componentsRef.current;
      const fragments = components.get(OBC.FragmentsManager);
      const fragData = new Uint8Array(fragBuffer);

      await fragments.core.load(fragData, { modelId: selectedFile.name });
      await fragments.core.update(true);

      // 카메라 맞추기
      const worlds = components.get(OBC.Worlds);
      const world = Array.from(worlds.list.values())[0] as any;
      if (world?.camera?.controls) {
        await world.camera.controls.fitToSphere(world.scene.three, true);
      }

      setPhase("done");
      setStatus("완료! 모델이 로드되었습니다.");
    } catch (err: any) {
      setPhase("error");
      setError(err.message || "처리 중 오류 발생");
      setStatus("오류 발생");
    }
  }, [selectedFile]);

  const isProcessing = ["uploading", "converting", "downloading", "loading"].includes(phase);

  return (
    <div style={{ display: "flex", flexDirection: "column", height }}>
      {/* 상단 컨트롤 */}
      <div
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid #e5e7eb",
          background: "#fafafa",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 15 }}>IFC Viewer (서버 변환)</strong>

          <input
            type="file"
            accept=".ifc"
            onChange={handleFileSelect}
            disabled={isProcessing}
          />

          <button
            onClick={handleUploadAndConvert}
            disabled={!selectedFile || isProcessing}
            style={{
              padding: "8px 20px",
              background: !selectedFile || isProcessing ? "#ccc" : "#1976d2",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: !selectedFile || isProcessing ? "not-allowed" : "pointer",
            }}
          >
            {isProcessing ? "처리 중..." : "업로드 & 변환"}
          </button>

          <span style={{ fontSize: 13, color: "#6b7280" }}>{status}</span>
        </div>

        {/* 프로그레스 바 */}
        {phase === "uploading" && uploadProgress > 0 && uploadProgress < 100 && (
          <div style={{ height: 4, background: "#e0e0e0", borderRadius: 2 }}>
            <div
              style={{
                width: `${uploadProgress}%`,
                height: "100%",
                background: "#1976d2",
                borderRadius: 2,
                transition: "width 0.3s",
              }}
            />
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "8px 12px",
              background: "#fdecea",
              color: "#b71c1c",
              borderRadius: 4,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* 3D 뷰어 */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          background:
            "linear-gradient(180deg, rgba(248,250,252,1) 0%, rgba(241,245,249,1) 100%)",
        }}
      />
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
