import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

function prefixClasses(classStr: string): string {
  return classStr
    .split(/(\s+)/)
    .map((part) => {
      if (!part.trim()) return part;
      if (part.startsWith('tw:')) return part;
      return `tw:${part}`;
    })
    .join('');
}

interface Replacement {
  start: number;
  end: number;
  newText: string;
}

function processFile(filePath: string) {
  const code = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true);

  const replacements: Replacement[] = [];

  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.text === 'className') {
      const initializer = node.initializer;
      if (initializer) {
        if (ts.isStringLiteral(initializer)) {
          const raw = initializer.getText(sourceFile);
          const quote = raw[0];
          const innerText = raw.slice(1, -1);
          const prefixed = prefixClasses(innerText);
          replacements.push({
            start: initializer.getStart(sourceFile),
            end: initializer.getEnd(),
            newText: quote + prefixed + quote,
          });
        } else if (ts.isJsxExpression(initializer)) {
          function visitExpr(exprNode: ts.Node) {
            if (ts.isStringLiteral(exprNode)) {
              const raw = exprNode.getText(sourceFile);
              const quote = raw[0];
              const innerText = raw.slice(1, -1);
              const prefixed = prefixClasses(innerText);
              replacements.push({
                start: exprNode.getStart(sourceFile),
                end: exprNode.getEnd(),
                newText: quote + prefixed + quote,
              });
            } else if (ts.isNoSubstitutionTemplateLiteral(exprNode)) {
              const raw = exprNode.getText(sourceFile);
              const innerText = raw.slice(1, -1);
              const prefixed = prefixClasses(innerText);
              replacements.push({
                start: exprNode.getStart(sourceFile),
                end: exprNode.getEnd(),
                newText: '`' + prefixed + '`',
              });
            } else if (
              ts.isTemplateHead(exprNode) ||
              ts.isTemplateMiddle(exprNode) ||
              ts.isTemplateTail(exprNode)
            ) {
              const raw = exprNode.getText(sourceFile);
              let innerText = '';
              let startLen = 0;
              let endLen = 0;
              if (ts.isTemplateHead(exprNode)) {
                innerText = raw.slice(1, -2);
                startLen = 1;
                endLen = 2;
              } else if (ts.isTemplateMiddle(exprNode)) {
                innerText = raw.slice(1, -2);
                startLen = 1;
                endLen = 2;
              } else if (ts.isTemplateTail(exprNode)) {
                innerText = raw.slice(1, -1);
                startLen = 1;
                endLen = 1;
              }
              const prefixed = prefixClasses(innerText);
              const rawStart = raw.slice(0, startLen);
              const rawEnd = raw.slice(raw.length - endLen);
              replacements.push({
                start: exprNode.getStart(sourceFile),
                end: exprNode.getEnd(),
                newText: rawStart + prefixed + rawEnd,
              });
            }
            ts.forEachChild(exprNode, visitExpr);
          }
          ts.forEachChild(initializer, visitExpr);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Sort replacements from end to start to avoid offset shifting
  replacements.sort((a, b) => b.start - a.start);

  // Apply replacements
  let newCode = code;
  for (const r of replacements) {
    newCode = newCode.slice(0, r.start) + r.newText + newCode.slice(r.end);
  }

  if (newCode !== code) {
    fs.writeFileSync(filePath, newCode, 'utf8');
    console.log(`Updated ${path.basename(filePath)} with ${replacements.length} replacements.`);
  } else {
    console.log(`No changes needed for ${path.basename(filePath)}.`);
  }
}

const files = [
  'src/my-tasks.web-view.tsx',
  'src/project-overview.web-view.tsx',
  'src/task-board.web-view.tsx',
];

files.forEach((f) => {
  const fullPath = path.resolve(process.cwd(), f);
  if (fs.existsSync(fullPath)) {
    processFile(fullPath);
  } else {
    console.error(`File not found: ${f}`);
  }
});
