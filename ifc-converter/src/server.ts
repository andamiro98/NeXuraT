import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { convertIfcToFragChunks } from "./converter";

const app = express();
const PORT = 3001;
const DEFAULT_CHUNK_TARGET_MB = 800;

app.use(cors());
app.use(express.json());

app.post("/convert", async (req, res) => {
  const { fileId, ifcPath, fragPath, chunkTargetMb } = req.body;

  if (!fileId || !ifcPath || !fragPath) {
    return res.status(400).json({
      status: "FAILED",
      message: "fileId, ifcPath, fragPath are required.",
    });
  }

  const resolvedIfcPath = path.resolve(ifcPath);
  const resolvedFragPath = path.resolve(fragPath);
  const parsedChunkTargetMb = Number.isFinite(Number(chunkTargetMb))
      ? Number(chunkTargetMb)
      : DEFAULT_CHUNK_TARGET_MB;

  console.log(`[convert:start] fileId=${fileId}`);
  console.log(` IFC(raw): ${ifcPath}`);
  console.log(` IFC(resolved): ${resolvedIfcPath}`);
  console.log(` Output(raw): ${fragPath}`);
  console.log(` Output(resolved): ${resolvedFragPath}`);
  console.log(` chunkTargetMb: ${parsedChunkTargetMb}`);

  try {
    if (!fs.existsSync(resolvedIfcPath)) {
      return res.status(404).json({
        status: "FAILED",
        fileId,
        message: `Input IFC file does not exist: ${resolvedIfcPath}`,
      });
    }

    const startTime = Date.now();
    const fileSize = fs.statSync(resolvedIfcPath).size;

    console.log(`[convert:mode] chunked frag conversion (${(fileSize / (1024 * 1024)).toFixed(0)}MB)`);

    const result = await convertIfcToFragChunks(
        fileId,
        resolvedIfcPath,
        resolvedFragPath,
        { chunkTargetMb: parsedChunkTargetMb }
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[convert:done] fileId=${fileId} (${elapsed}s) chunks=${result.totalChunks}`);

    return res.json({
      status: "COMPLETED",
      fileId,
      fragPath: result.fragFiles[0] ?? null,
      fragFiles: result.fragFiles,
      manifestPath: result.manifestPath,
      totalChunks: result.totalChunks,
      mode: result.mode,
      elapsedSeconds: elapsed,
    });
  } catch (error: any) {
    console.error(`[convert:failed] fileId=${fileId}`, error);

    return res.status(500).json({
      status: "FAILED",
      fileId,
      message: error?.message || "Unknown error",
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "OK", service: "ifc-converter" });
});

app.listen(PORT, () => {
  console.log(`=== IFC converter listening on http://localhost:${PORT} ===`);
  console.log("  POST /convert  -> IFC split + chunked .frag conversion");
  console.log("  GET  /health   -> health check");
});
