import * as fs from "fs";
import * as path from "path";
import * as FRAGS from "@thatopen/fragments";

function getLocalWebIfcWasmDir(): string {
  const webIfcEntryPath = require.resolve("web-ifc");
  const webIfcDir = path.dirname(webIfcEntryPath);
  const wasmFilePath = path.join(webIfcDir, "web-ifc-node.wasm");

  if (!fs.existsSync(wasmFilePath)) {
    throw new Error(
        [
          "web-ifc-node.wasm 파일을 찾을 수 없습니다.",
          `확인한 경로: ${wasmFilePath}`,
          `web-ifc 엔트리 경로: ${webIfcEntryPath}`,
        ].join(" ")
    );
  }

  return path.resolve(webIfcDir).replace(/\\/g, "/") + "/";
}

export async function convertIfcToFrag(
    ifcPath: string,
    fragPath: string
): Promise<void> {
  if (!fs.existsSync(ifcPath)) {
    throw new Error(`IFC 파일을 찾을 수 없습니다: ${ifcPath}`);
  }

  const outputDir = path.dirname(fragPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const wasmDir = getLocalWebIfcWasmDir();
  console.log(`  web-ifc WASM 경로: ${wasmDir}`);

  console.log(`  IFC 파일 읽기 중: ${ifcPath}`);
  const ifcBuffer = fs.readFileSync(ifcPath);
  const ifcBytes = new Uint8Array(ifcBuffer);

  console.log(`  파일 크기: ${(ifcBytes.length / (1024 * 1024)).toFixed(1)}MB`);
  console.log(`  파싱 및 변환 중...`);

  const importer = new FRAGS.IfcImporter();
  importer.wasm = {
    path: wasmDir,
    absolute: true,
  };

  const fragArrayBuffer = await importer.process({
    bytes: ifcBytes,
  });

  fs.writeFileSync(fragPath, Buffer.from(fragArrayBuffer));

  console.log(`  .frag 파일 저장 완료: ${fragPath}`);
  console.log(`  출력 크기: ${(fs.statSync(fragPath).size / (1024 * 1024)).toFixed(1)}MB`);
}