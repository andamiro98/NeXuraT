import * as fs from "fs";
import * as path from "path";
import * as WEBIFC from "web-ifc";

function getArg(name: string, fallback?: string): string {
    const prefix = `--${name}=`;
    const found = process.argv.find((arg: string) => arg.startsWith(prefix));
    if (found) return found.slice(prefix.length);
    if (fallback !== undefined) return fallback;
    throw new Error(`필수 인자 누락: --${name}=...`);
}

function formatBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
        value /= 1024;
        idx++;
    }
    return `${value.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

function printProcessMemory(prefix: string) {
    const m = process.memoryUsage();
    console.log(
        `${prefix} rss=${formatBytes(m.rss)}, heapUsed=${formatBytes(m.heapUsed)}, heapTotal=${formatBytes(m.heapTotal)}, external=${formatBytes(m.external)}`
    );
}

async function main() {
    const ifcPath = path.resolve(getArg("ifc"));
    const memoryLimitMb = Number(getArg("mem", "8192"));
    const tapeSizeMb = Number(getArg("tape", "64"));

    if (!fs.existsSync(ifcPath)) {
        throw new Error(`IFC 파일이 없습니다: ${ifcPath}`);
    }

    const stat = fs.statSync(ifcPath);
    console.log("[TEST] 시작");
    console.log(`  파일: ${ifcPath}`);
    console.log(`  크기: ${formatBytes(stat.size)}`);
    console.log(`  MEMORY_LIMIT: ${memoryLimitMb} MB`);
    console.log(`  TAPE_SIZE: ${tapeSizeMb} MB`);
    printProcessMemory("  [MEM before]");

    const wasmPath = require.resolve("web-ifc/web-ifc-node.wasm");
    const wasmDir = path.dirname(wasmPath) + path.sep;

    const api = new WEBIFC.IfcAPI();
    const fd = fs.openSync(ifcPath, "r");

    let callbackCount = 0;
    let maxChunk = 0;
    let totalRead = 0;
    let lastLoggedStep = -1;

    try {
        await api.Init(
            (requestedFileName: string) => path.join(wasmDir, requestedFileName),
            true
        );

        console.log("  [INFO] Init 완료");
        printProcessMemory("  [MEM after init]");

        const modelID = api.OpenModelFromCallback(
            (offset: number, size: number): Uint8Array => {
                callbackCount++;
                maxChunk = Math.max(maxChunk, size);

                const buffer = Buffer.allocUnsafe(size);
                const bytesRead = fs.readSync(fd, buffer, 0, size, offset);
                totalRead = Math.max(totalRead, offset + bytesRead);

                const step256mb = Math.floor(totalRead / (256 * 1024 * 1024));
                if (step256mb !== lastLoggedStep) {
                    lastLoggedStep = step256mb;
                    console.log(
                        `  [READ] 누적=${formatBytes(totalRead)} / 마지막청크=${formatBytes(bytesRead)} / 요청청크=${formatBytes(size)} / callbackCount=${callbackCount}`
                    );
                    printProcessMemory("  [MEM reading]");
                }

                return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
            },
            {
                COORDINATE_TO_ORIGIN: true,
                MEMORY_LIMIT: memoryLimitMb * 1024 * 1024,
                TAPE_SIZE: tapeSizeMb * 1024 * 1024
            }
        );

        if (modelID === -1) {
            throw new Error("OpenModelFromCallback 실패: modelID = -1");
        }

        const schema = api.GetModelSchema(modelID);

        console.log("[TEST] 성공");
        console.log(`  modelID=${modelID}`);
        console.log(`  schema=${schema}`);
        console.log(`  callbackCount=${callbackCount}`);
        console.log(`  maxChunk=${formatBytes(maxChunk)}`);
        printProcessMemory("  [MEM success]");

        api.CloseModel(modelID);
    } catch (err) {
        console.error(`  [FAIL POINT] totalRead=${formatBytes(totalRead)}, callbackCount=${callbackCount}, maxChunk=${formatBytes(maxChunk)}`);
        printProcessMemory("  [MEM fail]");
        throw err;
    } finally {
        fs.closeSync(fd);
    }
}

main().catch((err) => {
    console.error("[TEST] 실패");
    console.error(err);
    process.exit(1);
});