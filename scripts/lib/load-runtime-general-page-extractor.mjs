import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

let extractorModulePromise;

export async function loadRuntimeGeneralPageExtractor() {
  if (!extractorModulePromise) {
    extractorModulePromise = importRuntimeExtractor();
  }
  return extractorModulePromise;
}

async function importRuntimeExtractor() {
  const sourcePath = path.resolve(process.cwd(), "src/lib/general-page-extraction.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      verbatimModuleSyntax: false,
    },
    fileName: sourcePath,
  });
  const encoded = Buffer.from(transpiled.outputText, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}
