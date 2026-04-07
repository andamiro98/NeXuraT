import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import * as OBC from "@thatopen/components";
import * as THREE from "three";
import {
  uploadIfcFile,
  requestConversion,
  pollUntilComplete,
  downloadFragAsBuffer,
  downloadChunkFragAsBuffer,
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

const MAX_IFC_SIZE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GiB

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

export default function IfcServerViewer({ height = "100vh" }: IfcServerViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const componentsRef = useRef<OBC.Components | null>(null);
  const worldRef = useRef<any>(null);
  const fragmentsRef = useRef<any>(null);
  const currentModelIdsRef = useRef<string[]>([]);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [status, setStatus] = useState("Ready");
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

    const workerUrl = "/thatopen/worker.mjs?v=20260406";
    fragments.init(workerUrl);

    world.camera.controls.addEventListener("update", () => {
      fragments.core.update();
    });

    fragments.list.onItemSet.add(({ value: model }: any) => {
      try {
        if (!model?.object) {
          console.warn("[IFC Viewer] Loaded model has no object.", model);
          return;
        }

        model.useCamera(world.camera.three);

        if (model.object.parent !== world.scene.three) {
          world.scene.three.add(model.object);
        }

        fragments.core.update(true);
      } catch (sceneError) {
        console.error("[IFC Viewer] Failed to add model to scene:", sceneError);
      }
    });

    return () => {
      try {
        components.dispose();
      } finally {
        currentModelIdsRef.current = [];
        worldRef.current = null;
        fragmentsRef.current = null;
        componentsRef.current = null;
      }
    };
  }, []);

  const clearCurrentModel = useCallback(async () => {
    const fragments = fragmentsRef.current;

    if (!fragments) {
      currentModelIdsRef.current = [];
      return;
    }

    const modelIds = currentModelIdsRef.current.length > 0
      ? [...currentModelIdsRef.current]
      : Array.from(fragments.list.keys());

    for (const modelId of modelIds) {
      try {
        await fragments.core.disposeModel(modelId);
      } catch (disposeError) {
        console.warn("[IFC Viewer] Failed to dispose model:", modelId, disposeError);
      }
    }

    currentModelIdsRef.current = [];
  }, []);

  const handleFileSelect = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadProgress(0);

    if (!isIfcFile(file)) {
      setSelectedFile(null);
      setError("Only IFC files can be uploaded.");
      setPhase("error");
      setStatus("Invalid file type");
      e.target.value = "";
      return;
    }

    if (!isAllowedSize(file)) {
      setSelectedFile(null);
      setError(`This viewer currently accepts IFC files up to ${formatSize(MAX_IFC_SIZE_BYTES)}.`);
      setPhase("error");
      setStatus("File too large");
      e.target.value = "";
      return;
    }

    setSelectedFile(file);
    setError(null);
    setPhase("idle");
    setStatus(`Selected: ${file.name} (${formatSize(file.size)})`);
  }, []);

  const handleUploadAndConvert = useCallback(async () => {
    if (!selectedFile || !componentsRef.current || !worldRef.current || !fragmentsRef.current) {
      return;
    }

    if (!isIfcFile(selectedFile)) {
      setPhase("error");
      setError("Only IFC files can be uploaded.");
      setStatus("Invalid file type");
      return;
    }

    if (!isAllowedSize(selectedFile)) {
      setPhase("error");
      setError(`This viewer currently accepts IFC files up to ${formatSize(MAX_IFC_SIZE_BYTES)}.`);
      setStatus("File too large");
      return;
    }

    setError(null);
    setUploadProgress(0);

    const world = worldRef.current;
    const fragments = fragmentsRef.current;

    try {
      await clearCurrentModel();
      currentModelIdsRef.current = [];

      setPhase("uploading");
      setStatus("Uploading IFC to the server...");

      const uploadResult = await uploadIfcFile(selectedFile, (percent) => {
        setUploadProgress(percent);
        setStatus(`Uploading... ${percent}%`);
      });

      setPhase("converting");
      setStatus("Requesting chunked IFC -> frag conversion...");
      await requestConversion(uploadResult.fileId);

      setStatus("Server is converting IFC chunks...");

      const completedStatus = await new Promise<ConversionStatusResponse>((resolve, reject) => {
        let settled = false;
        const poller = pollUntilComplete(uploadResult.fileId, (convStatus: ConversionStatusResponse) => {
          if (settled) return;

          if (typeof convStatus.progressPercent === "number") {
            setStatus(`Converting... ${convStatus.progressPercent}%`);
          }

          if (convStatus.status === "COMPLETED") {
            settled = true;
            poller.cancel();
            resolve(convStatus);
          } else if (convStatus.status === "FAILED") {
            settled = true;
            poller.cancel();
            reject(new Error(convStatus.message || "Conversion failed"));
          }
        });
      });

      const totalChunks =
        completedStatus.totalChunks ??
        completedStatus.fragDownloadUrls?.length ??
        1;
      const isChunked = totalChunks > 1;
      const loadedModelIds: string[] = [];

      for (let i = 0; i < totalChunks; i++) {
        setPhase("downloading");
        setStatus(
            isChunked
              ? `.frag chunk download ${i + 1}/${totalChunks}...`
              : "Downloading .frag..."
        );

        const fragBuffer = isChunked
          ? await downloadChunkFragAsBuffer(uploadResult.fileId, i)
          : await downloadFragAsBuffer(uploadResult.fileId);

        if (!fragBuffer || fragBuffer.byteLength === 0) {
          throw new Error(`No data received for frag chunk ${i + 1}.`);
        }

        const fragBytes = new Uint8Array(fragBuffer);

        setPhase("loading");
        setStatus(
            isChunked
              ? `Loading chunk ${i + 1}/${totalChunks} into the viewer...`
              : "Loading model into the viewer..."
        );

        const modelId = isChunked
          ? `${selectedFile.name}-${uploadResult.fileId}-chunk-${i + 1}`
          : `${selectedFile.name}-${uploadResult.fileId}`;

        try {
          await fragments.core.load(fragBytes, { modelId });
          await fragments.core.update(true);
        } catch (chunkLoadError: any) {
          throw new Error(
            isChunked
              ? `Failed to load frag chunk ${i + 1}/${totalChunks}: ${chunkLoadError?.message || chunkLoadError}`
              : `Failed to load frag model: ${chunkLoadError?.message || chunkLoadError}`
          );
        }

        loadedModelIds.push(modelId);
        currentModelIdsRef.current = [...loadedModelIds];
      }

      if (loadedModelIds.length === 0) {
        throw new Error("No models were loaded into the viewer.");
      }

      const box = new THREE.Box3();
      for (const modelId of loadedModelIds) {
        const model = fragments.list.get(modelId);
        if (model?.object) {
          box.expandByObject(model.object);
        }
      }

      if (world.camera?.controls && !box.isEmpty()) {
        await world.camera.controls.fitToBox(box, true);
      }

      setPhase("done");
      setStatus(
          isChunked
            ? `Complete! ${loadedModelIds.length} frag chunks loaded.`
            : "Complete! Model loaded into the viewer."
      );
    } catch (err: any) {
      console.error("[IFC Viewer] Processing error:", err);
      setPhase("error");
      setError(err?.message || "An error occurred while processing the IFC file.");
      setStatus("Error");
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
            <strong style={{ fontSize: 15 }}>IFC Viewer (Server Chunk Conversion)</strong>

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
              {isProcessing ? "Processing..." : "Upload & Convert"}
            </button>

            <span style={{ fontSize: 13, color: "#6b7280" }}>{status}</span>
          </div>

          <div style={{ fontSize: 12, color: "#6b7280" }}>
            {"Current flow: upload IFC -> server chunk split -> chunked .frag conversion -> sequential viewer load"}
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
