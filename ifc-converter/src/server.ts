import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { convertIfcToFrag } from "./converter";

const app = express();
const PORT = 3001;
const TWO_GB = 2 * 1024 * 1024 * 1024;

app.use(cors());
app.use(express.json());

/**
 * POST /convert
 *
 * 단일 변환 정책:
 * - IFC 파일 분할 없음
 * - 2GB 이하 IFC만 허용
 * - 서버가 원본 IFC 1개를 단일 .frag 1개로 변환
 */
app.post("/convert", async (req, res) => {
  const { fileId, ifcPath, fragPath } = req.body;

  if (!fileId || !ifcPath || !fragPath) {
    return res.status(400).json({
      status: "FAILED",
      message: "fileId, ifcPath, fragPath 모두 필요합니다.",
    });
  }

  const resolvedIfcPath = path.resolve(ifcPath);
  const resolvedFragPath = path.resolve(fragPath);

  console.log(`[변환 시작] fileId=${fileId}`);
  console.log(` IFC(raw): ${ifcPath}`);
  console.log(` IFC(resolved): ${resolvedIfcPath}`);
  console.log(` 출력(raw): ${fragPath}`);
  console.log(` 출력(resolved): ${resolvedFragPath}`);

  try {
    if (!fs.existsSync(resolvedIfcPath)) {
      return res.status(404).json({
        status: "FAILED",
        fileId,
        message: `입력 IFC 파일이 존재하지 않습니다: ${resolvedIfcPath}`,
      });
    }

    const startTime = Date.now();
    const fileSize = fs.statSync(resolvedIfcPath).size;

    if (fileSize > TWO_GB) {
      return res.status(400).json({
        status: "FAILED",
        fileId,
        message: `2GB 이하 IFC만 변환할 수 있습니다. 현재 파일 크기: ${(fileSize / (1024 * 1024 * 1024)).toFixed(2)}GB`,
      });
    }

    console.log(`[변환 모드] 직접 변환 (${(fileSize / (1024 * 1024)).toFixed(0)}MB)`);

    await convertIfcToFrag(resolvedIfcPath, resolvedFragPath);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[변환 완료] fileId=${fileId} (${elapsed}초)`);

    return res.json({
      status: "COMPLETED",
      fileId,
      fragPath,
      elapsedSeconds: elapsed,
    });
  } catch (error: any) {
    console.error(`[변환 실패] fileId=${fileId}`, error);

    return res.status(500).json({
      status: "FAILED",
      fileId,
      message: error?.message || "알 수 없는 오류",
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "OK", service: "ifc-converter" });
});

app.listen(PORT, () => {
  console.log(`=== IFC 변환 서버 실행 중: http://localhost:${PORT} ===`);
  console.log(`  POST /convert  — IFC → 단일 .frag 변환`);
  console.log(`  GET  /health   — 헬스체크`);
});
