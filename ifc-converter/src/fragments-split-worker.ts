import fs from "fs";
import path from "path";
import * as FRAGS from "@thatopen/fragments";

function main() {
  const [, , ifcPathArg, outDirArg, targetMbArg] = process.argv;

  if (!ifcPathArg || !outDirArg) {
    console.error("Usage: node fragments-split-worker <ifcPath> <outDir> [targetMb]");
    process.exit(1);
  }

  const ifcPath = path.resolve(ifcPathArg);
  const outDir = path.resolve(outDirArg);
  const targetMb = Math.max(1, Number(targetMbArg || 800));

  if (!fs.existsSync(ifcPath)) {
    console.error(`Input IFC file does not exist: ${ifcPath}`);
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const fileSize = fs.statSync(ifcPath).size;
  const targetBytes = targetMb * 1024 * 1024;
  const estimatedChunkCount = Math.max(1, Math.ceil(fileSize / targetBytes));

  console.log(`  Fragments split target size: ${targetMb}MB`);
  console.log(`  Fragments split estimated chunks: ${estimatedChunkCount}`);

  FRAGS.split({ fs, path }, ifcPath, estimatedChunkCount, outDir);

  const chunkIfcPaths = fs
      .readdirSync(outDir)
      .filter((entry) => entry.toLowerCase().endsWith(".ifc"))
      .sort()
      .map((entry) => path.join(outDir, entry));

  if (chunkIfcPaths.length === 0) {
    console.error("Fragments split completed without IFC chunks.");
    process.exit(1);
  }

  console.log(`RESULT_FILES:${chunkIfcPaths.join("|")}`);
}

main();
