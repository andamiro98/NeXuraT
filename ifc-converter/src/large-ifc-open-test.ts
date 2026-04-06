/**
 * large-ifc-open-test.ts
 *
 * web-ifc의 OpenModelFromCallback을 사용해
 * 대용량 IFC 파일을 청크 단위로 파서에 공급하면서
 * 메모리·진행 상황을 상세 로깅하는 테스트.
 *
 * 이전 실패 기록: 2.69 GB 지점에서 WASM 내부 메모리 포화 → 크래시
 *
 * 실행 예시:
 *   npx ts-node src/large-ifc-open-test.ts \
 *     --ifc=C:/models/large.ifc \
 *     --mem=12288 \
 *     --tape=128 \
 *     --log-step=128
 *
 * npm 스크립트로 실행할 때 (package.json):
 *   "test:large-open": "node --max-old-space-size=16384 -r ts-node/register src/large-ifc-open-test.ts"
 *
 * 인자:
 *   --ifc=<path>         IFC 파일 경로 (필수)
 *   --mem=<MB>           web-ifc MEMORY_LIMIT (기본: 8192 MB = 8 GB)
 *   --tape=<MB>          web-ifc TAPE_SIZE    (기본: 128 MB)
 *   --log-step=<MB>      진행 로그 간격 (기본: 128 MB)
 *   --rss-warn=<MB>      Node RSS 경고 임계 (기본: 14336 MB = 14 GB)
 *   --heartbeat=<sec>    내부 처리 중 heartbeat 간격 초 (기본: 30)
 *
 *
 * 실행 : py src/python/split_ifc_streaming.py <IFC 경로> <OUTPUT 경로> 800
 */

import * as fs from "fs";
import * as path from "path";
import * as WEBIFC from "web-ifc";

// ─────────────────────────────────────────────
// CLI 인자 파싱
// ─────────────────────────────────────────────
function getArg(name: string, fallback?: string): string {
    const prefix = `--${name}=`;
    const found = process.argv.find((a) => a.startsWith(prefix));
    if (found) return found.slice(prefix.length);
    if (fallback !== undefined) return fallback;
    throw new Error(`필수 인자 누락: --${name}=...`);
}

// ─────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────
function formatBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function printMem(label: string): void {
    const m = process.memoryUsage();
    console.log(
        `${label} rss=${formatBytes(m.rss)}` +
        ` heapUsed=${formatBytes(m.heapUsed)}` +
        ` heapTotal=${formatBytes(m.heapTotal)}` +
        ` external=${formatBytes(m.external)}`
    );
}

function nowStr(): string {
    return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function elapsedSec(startMs: number): string {
    return ((Date.now() - startMs) / 1000).toFixed(1) + "s";
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────
async function main(): Promise<void> {
    const ifcPath      = path.resolve(getArg("ifc"));
    const memLimitMb   = Number(getArg("mem",      "8192"));
    const tapeSizeMb   = Number(getArg("tape",     "128"));
    const logStepMb    = Number(getArg("log-step",  "128"));
    const rssWarnMb    = Number(getArg("rss-warn",  "14336"));
    const heartbeatSec = Number(getArg("heartbeat", "30"));

    if (!fs.existsSync(ifcPath)) {
        throw new Error(`IFC 파일이 없습니다: ${ifcPath}`);
    }

    const stat = fs.statSync(ifcPath);
    const fileSizeBytes = stat.size;

    console.log("═══════════════════════════════════════════════════");
    console.log(" [TEST] large-ifc-open-test via OpenModelFromCallback");
    console.log("═══════════════════════════════════════════════════");
    console.log(`  실행 시각    : ${nowStr()}`);
    console.log(`  IFC 파일     : ${ifcPath}`);
    console.log(`  파일 크기    : ${formatBytes(fileSizeBytes)}`);
    console.log(`  MEMORY_LIMIT : ${memLimitMb} MB  (web-ifc WASM 내부 힙)`);
    console.log(`  TAPE_SIZE    : ${tapeSizeMb} MB  (파서 테이프 버퍼)`);
    console.log(`  로그 간격    : ${logStepMb} MB 마다`);
    console.log(`  RSS 경고     : ${rssWarnMb} MB 초과 시 경고`);
    console.log(`  Heartbeat    : ${heartbeatSec}초 마다`);
    console.log("───────────────────────────────────────────────────");
    printMem("  [MEM init ]");
    console.log("───────────────────────────────────────────────────");

    // WASM 경로
    const wasmPath = require.resolve("web-ifc/web-ifc-node.wasm");
    const wasmDir  = path.dirname(wasmPath) + path.sep;

    const api = new WEBIFC.IfcAPI();

    // ── Init ──────────────────────────────────
    let t0 = Date.now();
    await api.Init(
        (requestedFileName: string) => path.join(wasmDir, requestedFileName),
        true
    );
    console.log(`  [INFO] Init 완료  (${elapsedSec(t0)})`);
    printMem("  [MEM after-init ]");
    console.log("───────────────────────────────────────────────────");

    // ── 파일 디스크립터 열기 ──────────────────
    const fd = fs.openSync(ifcPath, "r");

    let callbackCount  = 0;   // OpenModelFromCallback 호출 횟수
    let totalRead      = 0;   // offset + bytesRead 의 최대값
    let maxChunkSize   = 0;   // 가장 큰 단일 청크 크기
    let lastLoggedStep = -1;  // 마지막으로 로그를 찍은 logStep 단계

    const logStepBytes = logStepMb * 1024 * 1024;
    const rssWarnBytes = rssWarnMb * 1024 * 1024;

    // ── Heartbeat 타이머 ───────────────────────
    // OpenModelFromCallback이 내부 처리 중일 때 콜백이 없어도
    // 30초마다 메모리 상태를 출력해 hang vs 정상 처리 구분
    let heartbeatPhase = "init";
    let lastCallbackCount = 0;
    let lastCallbackTime = Date.now();
    const HEARTBEAT_MS = heartbeatSec * 1000;

    const heartbeat = setInterval(() => {
        const silentSec = ((Date.now() - lastCallbackTime) / 1000).toFixed(0);
        const callbacksRecent = callbackCount - lastCallbackCount;
        lastCallbackCount = callbackCount;
        lastCallbackTime = Date.now();
        console.log(
            `  [HEARTBEAT] phase=${heartbeatPhase}` +
            ` totalRead=${formatBytes(totalRead)}` +
            ` calls=${callbackCount}` +
            ` (+${callbacksRecent} in last ${silentSec}s)` +
            ` elapsed=${elapsedSec(t0)}`
        );
        printMem("  [MEM heartbeat]  ");

        const rss = process.memoryUsage().rss;
        if (rss > rssWarnBytes) {
            console.warn(
                `  ⚠️  [RSS WARN] Node RSS=${formatBytes(rss)} > 경고 임계(${rssWarnMb} MB). OOM 위험!`
            );
        }
    }, HEARTBEAT_MS);
    heartbeat.unref(); // 프로세스 종료를 막지 않음

    // 콜백 내부에서 던져진 에러를 바깥에서 잡기 위한 변수
    let callbackError: Error | null = null;

    try {
        // ── OpenModelFromCallback ─────────────
        const tOpen = Date.now();
        t0 = tOpen; // heartbeat가 OpenModel 시작 시각 기준으로 경과 시간 표시
        const modelID = api.OpenModelFromCallback(
            (offset: number, size: number): Uint8Array => {
                heartbeatPhase = "reading";
                lastCallbackTime = Date.now();
                // 이전 콜백에서 에러가 발생했으면 빈 배열 반환
                if (callbackError) return new Uint8Array(0);

                callbackCount++;
                maxChunkSize = Math.max(maxChunkSize, size);

                // 파일 읽기
                const buffer = Buffer.allocUnsafe(size);
                let bytesRead = 0;
                try {
                    bytesRead = fs.readSync(fd, buffer, 0, size, offset);
                } catch (readErr: unknown) {
                    callbackError = readErr instanceof Error ? readErr : new Error(String(readErr));
                    console.error(`  [ERROR] readSync 실패 @ offset=${formatBytes(offset)}: ${callbackError.message}`);
                    return new Uint8Array(0);
                }

                // 최대 읽기 위치 갱신
                const reachedPos = offset + bytesRead;
                if (reachedPos > totalRead) totalRead = reachedPos;

                // 진행 로그 (logStep MB 마다)
                const currentStep = Math.floor(totalRead / logStepBytes);
                if (currentStep !== lastLoggedStep) {
                    lastLoggedStep = currentStep;
                    const pct = ((totalRead / fileSizeBytes) * 100).toFixed(1);
                    console.log(
                        `  [READ] ${formatBytes(totalRead)} / ${formatBytes(fileSizeBytes)}` +
                        ` (${pct}%)` +
                        ` chunk=${formatBytes(size)} read=${formatBytes(bytesRead)}` +
                        ` calls=${callbackCount}` +
                        ` elapsed=${elapsedSec(tOpen)}`
                    );
                    printMem("  [MEM reading  ]");

                    // RSS 경고
                    const rss = process.memoryUsage().rss;
                    if (rss > rssWarnBytes) {
                        console.warn(
                            `  ⚠️  [RSS WARN] Node 프로세스 RSS=${formatBytes(rss)}` +
                            ` > 경고 임계(${rssWarnMb} MB). OOM 위험!`
                        );
                    }
                }

                return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
            },
            {
                COORDINATE_TO_ORIGIN: true,
                MEMORY_LIMIT: memLimitMb * 1024 * 1024,
                TAPE_SIZE:    tapeSizeMb * 1024 * 1024,
            }
        );

        // 콜백 내부 에러 재throw
        heartbeatPhase = "post-open";
        if (callbackError) throw callbackError;

        if (modelID === -1 || modelID === undefined) {
            throw new Error("OpenModelFromCallback 실패: modelID = " + modelID);
        }

        // ── 파싱 성공 ─────────────────────────
        const openElapsed = elapsedSec(tOpen);
        console.log("───────────────────────────────────────────────────");
        console.log("  [OPEN SUCCESS]");
        console.log(`    modelID      = ${modelID}`);
        console.log(`    경과 시간    = ${openElapsed}`);
        console.log(`    총 읽기량   = ${formatBytes(totalRead)}`);
        console.log(`    콜백 횟수   = ${callbackCount}`);
        console.log(`    최대 청크   = ${formatBytes(maxChunkSize)}`);
        printMem("  [MEM after-open ]");
        console.log("───────────────────────────────────────────────────");

        // 스키마 확인
        const schema = api.GetModelSchema(modelID);
        console.log(`    schema       = ${schema}`);

        // 엔티티 타입 리스트로 파싱 완료 확인
        console.log("  [INFO] 엔티티 타입 조회 중...");
        const tTypes = Date.now();
        const types = api.GetIfcEntityList(modelID);
        console.log(`    엔티티 타입 수 = ${types.length}  (${elapsedSec(tTypes)})`);

        // 샘플로 IfcProject 엔티티 수 조회
        try {
            const projects = api.GetLineIDsWithType(modelID, WEBIFC.IFCPROJECT);
            console.log(`    IfcProject 수  = ${projects.size()}`);
        } catch {
            // 일부 파일엔 IfcProject가 없을 수 있음
        }

        printMem("  [MEM after-query]");
        console.log("───────────────────────────────────────────────────");

        api.CloseModel(modelID);
        console.log("  [INFO] 모델 닫기 완료");

    } catch (err: unknown) {
        heartbeatPhase = "error";
        const msg = err instanceof Error ? err.message : String(err);
        console.log("═══════════════════════════════════════════════════");
        console.error("  [FAIL] 테스트 실패");
        console.error(`    실패 지점   : totalRead=${formatBytes(totalRead)}`);
        console.error(`    콜백 횟수   : ${callbackCount}`);
        console.error(`    최대 청크   : ${formatBytes(maxChunkSize)}`);
        console.error(`    오류 메시지 : ${msg}`);
        printMem("  [MEM fail     ]");
        console.log("═══════════════════════════════════════════════════");
        throw err;
    } finally {
        clearInterval(heartbeat);
        fs.closeSync(fd);
    }

    console.log("═══════════════════════════════════════════════════");
    console.log("  [TEST] 완료");
    console.log("═══════════════════════════════════════════════════");
}

main().catch((err) => {
    console.error("\n[FATAL]", err instanceof Error ? err.stack : err);
    process.exit(1);
});