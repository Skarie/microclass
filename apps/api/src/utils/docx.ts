/**
 * .docx（Word）读写：**不引入任何依赖**，用自带的 ZIP + OOXML 实现。
 *
 * - **写**：生成一个最小但合法的 docx（含样式、段落、可选内嵌图片），Word / WPS / LibreOffice 都能打开；
 * - **读**：解开 docx，从 `word/document.xml` 抽出段落文本（保留换行与制表符），
 *   再交给 `parseQuestionText` 按同一套文本规则解析 —— 老师用 Word 写题也能导入。
 *
 * 只支持常见的 docx 结构；图片只做「导出内嵌」，导入时图片需要另外上传（文本里会给出提示）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createZip, readZip, type ZipEntryInput } from './zip.js';

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/* ------------------------------------------------------------------ */
/* 写                                                                  */
/* ------------------------------------------------------------------ */

export interface DocxBlock {
  type:
    'title' | 'subtitle' | 'heading' | 'heading2' | 'strong' | 'text' | 'option' | 'answer' | 'analysis' | 'divider';
  text: string;
}

export interface DocxImage {
  /** 图片在 docx 内的文件名，如 image1.png */
  name: string;
  data: Buffer;
  /** 显示尺寸（磅值换算成 EMU 之前用像素近似即可） */
  widthPx: number;
  heightPx: number;
}

export interface BuildDocxInput {
  title: string;
  blocks: DocxBlock[];
  images: DocxImage[];
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** EMU：1 英寸 = 914400 EMU，按 96dpi 换算像素 */
const pxToEmu = (px: number): number => Math.round((px / 96) * 914400);

function paragraph(text: string, style: DocxBlock['type'], imageIndex?: number, images?: DocxImage[]): string {
  const styleMap: Record<DocxBlock['type'], string> = {
    title: 'Title',
    subtitle: 'Subtitle',
    heading: 'Heading1',
    heading2: 'Heading2',
    strong: 'Strong',
    text: 'Normal',
    option: 'Option',
    answer: 'Answer',
    analysis: 'Analysis',
    divider: 'Divider',
  };
  /** 文本段 → 一个或多个 run（`\n` 用 `<w:br/>` 表示） */
  const textRuns = (chunk: string): string => {
    const lines = chunk === '' ? [''] : chunk.split('\n');
    return lines
      .map(
        (line, i) =>
          `${i > 0 ? '<w:r><w:br/></w:r>' : ''}<w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`,
      )
      .join('');
  };
  const drawingFor = (index: number): string => {
    const img = images?.[index];
    if (!img) return '';
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
      <wp:extent cx="${pxToEmu(img.widthPx)}" cy="${pxToEmu(img.heightPx)}"/>
      <wp:docPr id="${index + 1}" name="${escapeXml(img.name)}"/>
      <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:nvPicPr><pic:cNvPr id="${index + 1}" name="${escapeXml(img.name)}"/><pic:cNvPicPr/></pic:nvPicPr>
            <pic:blipFill><a:blip r:embed="rIdImg${index + 1}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
            <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${pxToEmu(img.widthPx)}" cy="${pxToEmu(img.heightPx)}"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
          </pic:pic>
        </a:graphicData>
      </a:graphic>
    </wp:inline></w:drawing></w:r>`;
  };

  // 正文里可以内联 `[[img:N]]` 标记（题库题的图片就在题干/选项/解析中），
  // 按出现顺序把标记换成内嵌图片，其余文本切成 run；整段就是标记时等价于「段落 + 图片」。
  const runs = text
    .split(/(\[\[img:\d+\]\])/g)
    .map((part) => {
      const marker = /^\[\[img:(\d+)\]\]$/.exec(part);
      if (marker) return drawingFor(Number(marker[1]) - 1);
      return part === '' ? '' : textRuns(part);
    })
    .join('');
  // 兼容旧调用：段末追加图片（imageIndex 由调用方指定）
  const tail = imageIndex === undefined ? '' : drawingFor(imageIndex);

  return `<w:p><w:pPr><w:pStyle w:val="${styleMap[style]}"/></w:pPr>${runs}${tail}</w:p>`;
}

/** 生成 docx（正文按 blocks 顺序，图片内嵌在对应段落之后） */
export function buildDocx(input: BuildDocxInput): Buffer {
  const body: string[] = [];
  input.blocks.forEach((block) => {
    if (block.type === 'divider') {
      body.push(paragraph('', 'divider'));
      return;
    }
    // `[[img:N]]` 标记可以直接写在段落里（题干/选项/解析内联图片），paragraph() 会内联替换；
    // 整段就是标记时也走同一条路径，效果等价于「空段落 + 图片」。
    body.push(paragraph(block.text, block.type, undefined, input.images));
  });

  const documentXml =
    `${XML_HEAD}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
    `<w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;

  const stylesXml =
    `${XML_HEAD}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="微软雅黑" w:hAnsi="Calibri"/>` +
    `<w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:jc w:val="center"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:pPr><w:jc w:val="center"/></w:pPr>` +
    `<w:rPr><w:color w:val="666666"/><w:sz w:val="18"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>` +
    `<w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>` +
    `<w:pPr><w:spacing w:before="160" w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Strong"><w:name w:val="Strong"/>` +
    `<w:pPr><w:spacing w:before="80" w:after="40"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/>` +
    `<w:pPr><w:spacing w:after="60"/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Option"><w:name w:val="Option"/>` +
    `<w:pPr><w:ind w:left="420"/><w:spacing w:after="0"/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Answer"><w:name w:val="Answer"/>` +
    `<w:pPr><w:spacing w:before="60"/></w:pPr><w:rPr><w:b/><w:color w:val="1F6FEB"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Analysis"><w:name w:val="Analysis"/>` +
    `<w:rPr><w:color w:val="555555"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Divider"><w:name w:val="Divider"/>` +
    `<w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="CCCCCC"/></w:pBdr></w:pPr></w:style>` +
    `</w:styles>`;

  const contentTypes =
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="png" ContentType="image/png"/>` +
    `<Default Extension="jpeg" ContentType="image/jpeg"/>` +
    `<Default Extension="jpg" ContentType="image/jpeg"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `</Types>`;

  const rootRels =
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const docRels =
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    input.images
      .map(
        (img, i) =>
          `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${img.name}"/>`,
      )
      .join('') +
    `</Relationships>`;

  const entries: ZipEntryInput[] = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
    { name: 'word/styles.xml', data: Buffer.from(stylesXml, 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(docRels, 'utf8') },
    ...input.images.map((img) => ({ name: `word/media/${img.name}`, data: img.data })),
  ];
  return createZip(entries);
}

/* ------------------------------------------------------------------ */
/* 读                                                                  */
/* ------------------------------------------------------------------ */

export interface DocxImageFile {
  /** docx 内的条目名（如 image1.png），也是落盘时的建议文件名 */
  name: string;
  data: Buffer;
}

export interface DocxContent {
  /** 段落文本；图片位置会写成 `[[img:N]]` 标记（N 从 1 开始，对应 images[N-1]） */
  paragraphs: string[];
  /** 文档里内嵌的图片，按出现顺序 */
  images: DocxImageFile[];
}

/**
 * docx → 段落文本 + 内嵌图片。
 *
 * 图片通过 `word/_rels/document.xml.rels` 的 `r:embed="rIdN"` 解析到 `word/media/*`；
 * 文本流里的位置用 `[[img:N]]` 标记保留，便于导入时把图归到对应题目上。
 */
export function readDocx(buf: Buffer): DocxContent {
  const files = readZip(buf);
  const documentXml = files.get('word/document.xml');
  if (!documentXml) throw new Error('不是有效的 .docx（缺少 word/document.xml）');

  const xml = documentXml.toString('utf8');
  const rels = parseRels(files.get('word/_rels/document.xml.rels')?.toString('utf8') ?? '');

  const images: DocxImageFile[] = [];
  const byRel = new Map<string, number>();

  const paraRe = /<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g;
  const paragraphs: string[] = [];
  const matches = xml.match(paraRe) ?? [];

  // 文档顺序处理：`<w:t>` 文本、换行/制表符、图片（a:blip / v:imagedata）
  const tokenRe =
    /<w:t[^>]*>([\s\S]*?)<\/w:t>|<w:br\s*\/>|<w:tab\s*\/>|<a:blip[^>]*\br:embed="([^"]+)"|<v:imagedata[^>]*\br:id="([^"]+)"/g;

  for (const para of matches) {
    let text = '';
    let m: RegExpExecArray | null;
    tokenRe.lastIndex = 0;
    while ((m = tokenRe.exec(para)) !== null) {
      if (m[1] !== undefined) {
        text += decodeXml(m[1]);
        continue;
      }
      if (m[0].startsWith('<w:br')) {
        text += '\n';
        continue;
      }
      if (m[0].startsWith('<w:tab')) {
        text += '\t';
        continue;
      }
      const relId = m[2] ?? m[3] ?? '';
      const target = rels.get(relId);
      if (!target) continue;
      const entryName = target.startsWith('/') ? target.slice(1) : `word/${target}`;
      const data = files.get(entryName) ?? files.get(`word/${target.replace(/^\.\//, '')}`);
      if (!data) continue;
      let index = byRel.get(relId);
      if (index === undefined) {
        images.push({ name: entryName.split('/').pop() ?? `image${images.length + 1}`, data });
        index = images.length; // 1-based 标记
        byRel.set(relId, index);
      }
      text += `[[img:${index}]]`;
    }
    paragraphs.push(text.replace(/\t/g, ' ').trimEnd());
  }

  if (paragraphs.length === 0) {
    // 极简 docx（没有 w:p 包裹）兜底：把所有 w:t 抽出来
    const all = [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((x) => decodeXml(x[1] ?? ''));
    return { paragraphs: all, images };
  }
  return { paragraphs, images };
}

/** 读 rels：rId → Target */
function parseRels(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /<Relationship\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    const external = /\bTargetMode="External"/.test(m[0]);
    if (id && target && !external) out.set(id, target);
  }
  return out;
}

/** docx → 纯文本（去掉图片标记，段落换行） */
export function readDocxText(buf: Buffer): string {
  return readDocx(buf)
    .paragraphs.map((p) => p.replace(/\[\[img:\d+\]\]/g, '').trimEnd())
    .join('\n');
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** 读取 PNG / JPEG 的像素尺寸（用于在 Word 里保持比例）；识别失败返回 null */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  // PNG: 8 字节签名 + IHDR（长度 4 + 类型 4 + 宽高各 4）
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: 扫描 SOF 段
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1] as number;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      const len = buf.readUInt16BE(i + 2);
      i += 2 + len;
    }
  }
  return null;
}

/** 按前缀猜测图片扩展名（docx 里的 media 文件名） */
export function imageExtension(buf: Buffer, originalPath: string): string {
  if (buf.length > 4 && buf.readUInt32BE(0) === 0x89504e47) return 'png';
  if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  const ext = path.extname(originalPath).replace('.', '').toLowerCase();
  return ext === 'jpg' ? 'jpeg' : ext || 'png';
}

/** 读本地图片文件（失败返回 null，导出不因缺图中断） */
export function readImageFile(abs: string): Buffer | null {
  try {
    return fs.existsSync(abs) ? fs.readFileSync(abs) : null;
  } catch {
    return null;
  }
}
