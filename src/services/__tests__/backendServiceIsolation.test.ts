import * as fs from "fs";
import * as path from "path";
import ts from "typescript";

// Audit value-import edges (not erased type imports) in the staged gateway.
// This checks our source graph, not Metro's final bundle/native execution.
function runtimeDependencies(file: string): string[] {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const dependencies: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const onlyNamedTypes = clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
        && !clause.name && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(element => element.isTypeOnly);
      if (!clause?.isTypeOnly && !onlyNamedTypes) dependencies.push(node.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const onlyTypes = node.exportClause && ts.isNamedExports(node.exportClause)
        && node.exportClause.elements.every(element => element.isTypeOnly);
      if (!onlyTypes) dependencies.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) dependencies.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return dependencies;
}

test("staged gateway and screen ports cannot reach Appwrite or payment SDK/modules through value imports", () => {
  const sourceRoot = path.resolve(__dirname, "../..");
  const pending = [path.join(sourceRoot, "services/supabaseTestBackend.ts"), path.join(sourceRoot, "services/supabaseScreenPorts.ts"), path.join(sourceRoot, "services/supabaseTestScreenServices.ts")];
  const visited = new Set<string>();
  const violations: string[] = [];
  while (pending.length) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    for (const dependency of runtimeDependencies(file)) {
      if (dependency === "react-native-appwrite" || dependency === "react-native-purchases"
        || /^@\/services\/(appwrite|purchases|payments|supabaseCheckout(?:Runtime)?|supabasePaymentPlans|supabasePurchaseIntents)$/.test(dependency)) {
        violations.push(`${path.basename(file)} -> ${dependency}`);
      }
      const local = dependency.startsWith("@/") ? path.join(sourceRoot, dependency.slice(2))
        : dependency.startsWith(".") ? path.resolve(path.dirname(file), dependency) : null;
      if (local) {
        const resolved = [local + ".ts", local + ".tsx", path.join(local, "index.ts")].find(candidate => fs.existsSync(candidate));
        expect(resolved).toBeDefined();
        pending.push(resolved!);
      }
    }
  }
  expect(visited.size).toBeGreaterThan(30);
  expect(violations).toEqual([]);
});
