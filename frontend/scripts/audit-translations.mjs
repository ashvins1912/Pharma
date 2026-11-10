import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const filePath = path.resolve('src/context/LanguageContext.jsx');
const sourceText = fs.readFileSync(filePath, 'utf8');
const source = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const requiredLanguages = ['en', 'hi', 'kn', 'bn', 'te'];

function propertyName(property) {
  if (!property.name) return null;
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) return property.name.text;
  return null;
}

let messagesNode = null;
function visit(node) {
  if (ts.isVariableDeclaration(node) && propertyName({ name: node.name }) === 'messages' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
    messagesNode = node.initializer;
  }
  ts.forEachChild(node, visit);
}
visit(source);

if (!messagesNode) {
  console.error('Translation audit failed: could not find the messages dictionary.');
  process.exit(1);
}

const dictionaries = new Map();
for (const entry of messagesNode.properties) {
  if (!ts.isPropertyAssignment(entry)) continue;
  const language = propertyName(entry);
  if (!requiredLanguages.includes(language) || !ts.isObjectLiteralExpression(entry.initializer)) continue;
  const dictionary = new Map();
  for (const item of entry.initializer.properties) {
    if (!ts.isPropertyAssignment(item)) continue;
    const key = propertyName(item);
    if (!key) continue;
    if (dictionary.has(key)) {
      console.error(`Duplicate translation key "${key}" in ${language}.`);
      process.exitCode = 1;
    }
    const value = item.initializer;
    const text = ts.isStringLiteralLike(value) || ts.isNoSubstitutionTemplateLiteral(value) ? value.text : null;
    dictionary.set(key, text);
  }
  dictionaries.set(language, dictionary);
}

const reference = dictionaries.get('en');
if (!reference) {
  console.error('Translation audit failed: English dictionary is missing.');
  process.exit(1);
}

for (const language of requiredLanguages) {
  const dictionary = dictionaries.get(language);
  if (!dictionary) {
    console.error(`Missing language dictionary: ${language}`);
    process.exitCode = 1;
    continue;
  }
  const missing = [...reference.keys()].filter((key) => !dictionary.has(key));
  const extra = [...dictionary.keys()].filter((key) => !reference.has(key));
  const empty = [...dictionary].filter(([, value]) => typeof value !== 'string' || !value.trim()).map(([key]) => key);
  const placeholderMismatches = [];
  for (const [key, englishValue] of reference) {
    const translatedValue = dictionary.get(key);
    if (typeof englishValue !== 'string' || typeof translatedValue !== 'string') continue;
    const placeholders = (value) => [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]).sort().join('|');
    if (placeholders(englishValue) !== placeholders(translatedValue)) placeholderMismatches.push(key);
  }
  console.log(`${language}: ${dictionary.size}/${reference.size} keys`);
  if (missing.length || extra.length || empty.length || placeholderMismatches.length) {
    if (missing.length) console.error(`  Missing: ${missing.join(', ')}`);
    if (extra.length) console.error(`  Extra: ${extra.join(', ')}`);
    if (empty.length) console.error(`  Empty: ${empty.join(', ')}`);
    if (placeholderMismatches.length) console.error(`  Placeholder mismatch: ${placeholderMismatches.join(', ')}`);
    process.exitCode = 1;
  }
}

if (process.exitCode) {
  console.error('Translation coverage audit failed.');
} else {
  console.log('Translation coverage audit passed for all five supported languages.');
}
