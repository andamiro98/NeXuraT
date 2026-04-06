import { useCallback, useEffect, useRef, useState } from "react";
import * as OBC from "@thatopen/components";
import * as THREE from "three";
import {
  uploadIfcFile,
  requestConversion,
  pollUntilComplete,
  downloadFragAsBuffer,
  type ConversionStatusResponse,
} from "../../../api/ifcApi";

type IfcServerViewerProps = {
  height?: number | string;
};

type Phase =
    | "idle"
    | "uploading"
    | "converting"
    | "downloading"
    | "loading"
    | "done"
    | "error";

const MAX_IFC_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

function isIfcFile(file: File) {
  return file.name.toLowerCase().endsWith(".ifc");
}

function isAllowedSize(file: File) {
  return file.size <= MAX_IFC_SIZE_BYTES;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function waitForModelRef(
    modelRef: React.MutableRefObject<any>,
    timeoutMs = 10000
): Promise<any> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (modelRef.current) return modelRef.current;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("로드된 모델을 뷰어에서 찾지 못했습니다.");
}

export default function IfcServerViewer({height = "100vh",}: IfcServerViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const componentsRef = useRef<OBC.Components | null>(null);
  const worldRef = useRef<any>(null);
  const fragmentsRef = useRef<any>(null);
  const currentModelRef = useRef<any>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [status, setStatus] = useState("대기 중");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const isProcessing = ["uploading", "converting", "downloading", "loading"].includes(phase);

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
    worldRef.current = world;

    world.scene = new OBC.SimpleScene(components);
    world.scene.setup();
    world.scene.three.background = null;

    world.renderer = new OBC.SimpleRenderer(components, containerRef.current);
    world.camera = new OBC.OrthoPerspectiveCamera(components);
    world.camera.controls.setLookAt(12, 12, 12, 0, 0, 0);

    components.init();

    const fragments = components.get(OBC.FragmentsManager);
    fragmentsRef.current = fragments;

    const workerUrl = "/thatopen/worker.mjs?v=20260403";
    fragments.init(workerUrl);

    world.camera.controls.addEventListener("update", () => {
      fragments.core.update();
    });

    fragments.list.onItemSet.add(({ value: model }: any) => {
      try {
        if (!model?.object) {
          console.warn("[IFC Viewer] 로드된 모델 object가 없습니다.", model);
          return;
        }

        model.useCamera(world.camera.three);
        world.scene.three.add(model.object);
        currentModelRef.current = model;
        fragments.core.update(true);

        console.log("[IFC Viewer] model added to scene:", model.modelId);
      } catch (sceneError) {
        console.error("[IFC Viewer] scene 추가 중 오류:", sceneError);
      }
    });

    return () => {
      try {
        components.dispose();
      } finally {
        currentModelRef.current = null;
        worldRef.current = null;
        fragmentsRef.current = null;
        componentsRef.current = null;
      }
    };
  }, []);

  const clearCurrentModel = useCallback(async () => {
    const fragments = fragmentsRef.current;
    const model = currentModelRef.current;

    if (!fragments || !model) return;

    try {
      const modelId = model.modelId;
      if (modelId) {
        await fragments.core.disposeModel(modelId);
      }
    } catch (disposeError) {
      console.warn("[IFC Viewer] 기존 모델 제거 중 경고:", disposeError);
    } finally {
      currentModelRef.current = null;
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadProgress(0);

    if (!isIfcFile(file)) {
      setSelectedFile(null);
      setError("IFC 파일만 업로드할 수 있습니다.");
      setPhase("error");
      setStatus("파일 형식 오류");
      e.target.value = "";
      return;
    }

    if (!isAllowedSize(file)) {
      setSelectedFile(null);
      setError(
          `2GB 이하 IFC 파일만 업로드할 수 있습니다. 선택한 파일 크기: ${formatSize(file.size)}`
      );
      setPhase("error");
      setStatus("파일 크기 초과");
      e.target.value = "";
      return;
    }

    setSelectedFile(file);
    setError(null);
    setPhase("idle");
    setStatus(`파일 선택됨: ${file.name} (${formatSize(file.size)})`);
  }, []);

  const handleUploadAndConvert = useCallback(async () => {
    if (!selectedFile || !componentsRef.current || !worldRef.current || !fragmentsRef.current) {
      return;
    }

    if (!isIfcFile(selectedFile)) {
      setPhase("error");
      setError("IFC 파일만 업로드할 수 있습니다.");
      setStatus("파일 형식 오류");
      return;
    }

    if (!isAllowedSize(selectedFile)) {
      setPhase("error");
      setError(
          `2GB 이하 IFC 파일만 업로드할 수 있습니다. 현재 파일 크기: ${formatSize(selectedFile.size)}`
      );
      setStatus("파일 크기 초과");
      return;
    }

    setError(null);
    setUploadProgress(0);

    const world = worldRef.current;
    const fragments = fragmentsRef.current;

    try {
      await clearCurrentModel();

      setPhase("uploading");
      setStatus("서버에 IFC 업로드 중...");

      const uploadResult = await uploadIfcFile(selectedFile, (percent) => {
        setUploadProgress(percent);
        setStatus(`업로드 중... ${percent}%`);
      });

      setPhase("converting");
      setStatus("서버에서 IFC → .frag 변환 요청 중...");
      await requestConversion(uploadResult.fileId);

      setStatus("서버에서 변환 중...");

      await new Promise<void>((resolve, reject) => {
        pollUntilComplete(uploadResult.fileId, (convStatus: ConversionStatusResponse) => {
          if (typeof convStatus.progressPercent === "number") {
            setStatus(`변환 중... ${convStatus.progressPercent}%`);
          }

          if (convStatus.status === "COMPLETED") {
            resolve();
          } else if (convStatus.status === "FAILED") {
            reject(new Error(convStatus.message || "변환 실패"));
          }
        });
      });

      setPhase("downloading");
      setStatus(".frag 바이너리 수신 중...");
      const fragBuffer = await downloadFragAsBuffer(uploadResult.fileId);

      if (!fragBuffer || fragBuffer.byteLength === 0) {
        throw new Error(".frag 데이터를 받지 못했습니다.");
      }

      console.log("[IFC Viewer] fragBuffer.byteLength =", fragBuffer.byteLength);

      setPhase("loading");
      setStatus("3D 모델 로딩 중...");

      currentModelRef.current = null;

      // 중요: ArrayBuffer 그대로 전달
      await fragments.core.load(fragBuffer, {
        modelId: `${selectedFile.name}-${uploadResult.fileId}`,
      });

      await fragments.core.update(true);

      const loadedModel = await waitForModelRef(currentModelRef, 10000);

      if (!loadedModel?.object) {
        throw new Error("로드된 모델 object를 찾지 못했습니다.");
      }

      if (world.camera?.controls) {
        const box = new THREE.Box3().setFromObject(loadedModel.object);

        if (!box.isEmpty()) {
          await world.camera.controls.fitToBox(box, true);
        } else {
          console.warn("[IFC Viewer] 모델 bounding box가 비어 있습니다.");
        }
      }

      setPhase("done");
      setStatus("완료! 모델이 뷰어에 표시되었습니다.");
    } catch (err: any) {
      console.error("[IFC Viewer] 처리 오류:", err);
      setPhase("error");
      setError(err?.message || "처리 중 오류가 발생했습니다.");
      setStatus("오류 발생");
    }
  }, [clearCurrentModel, selectedFile]);

  return (
      <div style={{ display: "flex", flexDirection: "column", height }}>
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
            <strong style={{ fontSize: 15 }}>IFC Viewer (서버 단일 변환)</strong>

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

          <div style={{ fontSize: 12, color: "#6b7280" }}>
            현재 정책: 2GB 이하 IFC만 허용 / 서버 단일 변환 / 단일 .frag만 로드 / 사용자 다운로드 불필요
          </div>

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