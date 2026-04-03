import * as fs from "fs";
import * as path from "path";
import * as WEBIFC from "web-ifc";

type CliOptions = {
    ifcPath: string;
    memoryLimitMb: number;
};

function getArg(name: string, fallback?: string): string {
    const prefix = `--${name}=`;
    const found = process.argv.find((arg) => arg.startsWith(prefix));
    if (found) return found.slice(prefix.length);
    if (fallback !== undefined) return fallback;
    throw new Error(`필수 인자가 없습니다: --${name}=...`);
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

function resolveWasmDir(): string {
    const wasmPath = require.resolve("web-ifc/web-ifc-node.wasm");
    return path.dirname(wasmPath) + path.sep;
}

function parseOptions(): CliOptions {
    return {
        ifcPath: path.resolve(getArg("ifc")),
        memoryLimitMb: Number(getArg("mem", "4096")),
    };
}

async function main() {
    const options = parseOptions();

    if (!fs.existsSync(options.ifcPath)) {
        throw new Error(`IFC 파일이 없습니다: ${options.ifcPath}`);
    }

    const stat = fs.statSync(options.ifcPath);
    console.log("[OPEN TEST] 시작");
    console.log(`  IFC 파일: ${options.ifcPath}`);
    console.log(`  파일 크기: ${formatBytes(stat.size)}`);
    console.log(`  MEMORY_LIMIT: ${options.memoryLimitMb} MB`);

    const fd = fs.openSync(options.ifcPath, "r");
    const api = new WEBIFC.IfcAPI();

    let maxRequestedChunk = 0;
    let callbackCount = 0;
    let lastLoggedOffset = -1;

    try {
        const wasmDir = resolveWasmDir();

        await api.Init((requestedFileName: string) => {
            return path.join(wasmDir, requestedFileName);
        }, true);

        api.SetLogLevel(WEBIFC.LogLevel.LOG_LEVEL_WARN);

        const modelID = api.OpenModelFromCallback(
            (offset: number, size: number): Uint8Array => {
                callbackCount++;
                maxRequestedChunk = Math.max(maxRequestedChunk, size);

                const buffer = Buffer.allocUnsafe(size);
                const bytesRead = fs.readSync(fd, buffer, 0, size, offset);

                const currentGb = Math.floor(offset / (1024 * 1024 * 1024));
                if (currentGb !== lastLoggedOffset) {
                    lastLoggedOffset = currentGb;
                    console.log(
                        `  [read] offset=${formatBytes(offset)} size=${formatBytes(size)} bytesRead=${formatBytes(bytesRead)}`
                    );
                }

                return new Uint8Array(
                    buffer.buffer,
                    buffer.byteOffset,
                    bytesRead
                );
            },
            {
                COORDINATE_TO_ORIGIN: true,
                MEMORY_LIMIT: options.memoryLimitMb * 1024 * 1024,
                TAPE_SIZE: 64 * 1024 * 1024,
            }
        );

        if (modelID === -1) {
            throw new Error("OpenModelFromCallback가 -1을 반환했습니다.");
        }

        const schema = api.GetModelSchema(modelID);

        console.log("[OPEN TEST] 성공");
        console.log(`  modelID=${modelID}`);
        console.log(`  schema=${schema}`);
        console.log(`  callbackCount=${callbackCount}`);
        console.log(`  maxRequestedChunk=${formatBytes(maxRequestedChunk)}`);

        api.CloseModel(modelID);
    } finally {
        fs.closeSync(fd);
    }
}

main().catch((err) => {
    console.error("[OPEN TEST] 실패");
    console.error(err);
    process.exit(1);
});