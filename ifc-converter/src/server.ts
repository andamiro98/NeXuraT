import express from "express";
import cors from "cors";
import { convertIfcToFrag } from "./converter";

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

/**
 * POST /convert
 *
 * Spring Boot에서 호출하는 변환 엔드포인트.
 * 로컬 파일 경로를 받아서 IFC → .frag 변환을 수행한다.
 *
 * 이 서비스는 추후 Electron 앱에서도 재사용 가능하다:
 *   - Electron: convertIfcToFrag()를 직접 import하여 호출
 *   - 웹 서비스: 이 Express 서버를 통해 HTTP로 호출
 */
app.post("/convert", async (req, res) => {
  const { fileId, ifcPath, fragPath } = req.body;

  if (!fileId || !ifcPath || !fragPath) {
    return res.status(400).json({
      status: "FAILED",
      message: "fileId, ifcPath, fragPath 모두 필요합니다.",
    });
  }

  console.log(`[변환 시작] fileId=${fileId}`);
  console.log(`  IFC: ${ifcPath}`);
  console.log(`  출력: ${fragPath}`);

  try {
    const startTime = Date.now();
    await convertIfcToFrag(ifcPath, fragPath);
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
      message: error.message || "알 수 없는 오류",
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "OK", service: "ifc-converter" });
});

app.listen(PORT, () => {
  console.log(`=== IFC 변환 서버 실행 중: http://localhost:${PORT} ===`);
  console.log(`  POST /convert  — IFC → .frag 변환`);
  console.log(`  GET  /health   — 헬스체크`);
});
