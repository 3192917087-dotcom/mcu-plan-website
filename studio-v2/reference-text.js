// Conservative cleanup shared by OCR, AI interpretation and outline validation.
// Recover numbering only with surrounding outline evidence; uncertain words stay
// visible for review rather than being guessed into a school's requirements.
export function normalizeReferenceSource(value = '', {ocr=false} = {}) {
  const original=String(value || '').replace(/\r\n?/g,'\n');
  const corrections=[];
  let lines=original.normalize('NFKC').replace(/\uFEFF/g,'').split('\n').map(line=>line.trim()
    .replace(/([\u3400-\u9fff])[ \t\u3000]+(?=[\u3400-\u9fff])/g,'$1')
    .replace(/^([LlI])(?=[\d.])/,'1')
    .replace(/^(\d+)\s*[.．]\s*(\d+)(?:\s*[.．]\s*(\d+))?/,(_,a,b,c)=>`${a}.${b}${c?'.'+c:''}`));
  const chapters=new Set(lines.map(line=>line.match(/^第\s*(\d{1,2})\s*章/)?.[1]).filter(Boolean));
  for(const line of lines) {const n=line.match(/^(\d{1,2})\.\d/);if(n)chapters.add(n[1]);}
  // Explicit late chapters and a real 10/11/12 sequence must not become 1.1/1.2.
  const lateChapterSequence=lines.some(line=>/^10\s+[^\d]/.test(line));
  const parents=new Set();
  for(const line of lines) {
    let n=line.match(/^([1-9])\.([1-9])(?:\D|$)/);
    if(!n) n=line.match(/^([1-9])([1-9])\s+[^\d]/);
    if(n) parents.add(`${n[1]}.${n[2]}`);
  }
  const longH2=new Set(lines.map(line=>line.match(/^([1-9])\.10\s/)?.[1]).filter(Boolean));
  const hasOcrNumbering=/^(?:[LlI]\d|[1-9][1-9][1-9]\s+)|^[1-9]\s+\./m.test(original);
  lines=lines.map(line=>{
    const before=line;
    // A real chapter has an explicit 第…章 marker, or a bare spaced number
    // handled by the parser. Compact 13/132 are OCR section numbers, not chap13.
    if(!/^第/.test(line)) {
      let m=line.match(/^([1-9])([1-9])\.([1-9])\s*(\D.*)$/);
      if(m && parents.has(`${m[1]}.${m[2]}`) && !(Number(m[1]+m[2])<=12 && chapters.has(m[1]+m[2]))) line=`${m[1]}.${m[2]}.${m[3]} ${m[4]}`;
      else if((m=line.match(/^([1-9])\.([1-9])([1-9])\s*(\D.*)$/)) && parents.has(`${m[1]}.${m[2]}`) && !longH2.has(m[1]) && (ocr || hasOcrNumbering)) line=`${m[1]}.${m[2]}.${m[3]} ${m[4]}`;
      else if((m=line.match(/^([1-9])([1-9])([1-9])\s*(\D.*)$/)) && parents.has(`${m[1]}.${m[2]}`)) line=`${m[1]}.${m[2]}.${m[3]} ${m[4]}`;
      else if((m=line.match(/^([1-9])([1-9])\s*(\D.*)$/)) && chapters.has(m[1]) && !(Number(m[1]+m[2])<=12 && chapters.has(m[1]+m[2])) && !lateChapterSequence && !/^\s*(?:章|[、.])/.test(m[3])) line=`${m[1]}.${m[2]} ${m[3]}`;
    }
    if(/^(?:第\s*[一二两三四五六七八九十\d]+\s*章|\d+(?:\.\d+){1,2})/.test(line)) {
      line=line.replace(/(?:\t+|\s*[.·…_－—-]{2,}\s*|\s*[.·]\s+|\s+[-=]?\s*)[\divxIVX]+\s*$/,'').trim();
      line=line.replace(/^(\d+(?:\.\d+){1,2})\s*/, '$1 ');
    }
    if(line!==before && line)corrections.push({before,after:line});
    return line;
  });
  return {text:lines.join('\n').replace(/\n{3,}/g,'\n\n').trim(),corrections};
}

export function referenceTextAssessment(value = '') {
  const normalized=normalizeReferenceSource(value);
  const lines=normalized.text.split('\n').filter(Boolean);
  const headings=lines.filter(line=>/^(?:第\s*[一二两三四五六七八九十\d]+\s*章|\d+(?:\.\d+){1,2}\s)/.test(line));
  const issues=[];
  for(const line of headings) {
    const title=line.replace(/^(?:第\s*[一二两三四五六七八九十\d]+\s*章|\d+(?:\.\d+){1,2})\s*/,'');
    const clean=title.replace(/[*＊#＃?？+“”"'\s]/g,'');
    if(/\uFFFD|[\uE000-\uF8FF]|(?:Ã|Â|锟斤拷)/.test(title)
      || /异块|徽控制器|林(?:.*(?:设计|技术|传感|协议))|烛异|村技术|桩协议|意共和?/.test(title)
      || /[=#$%&]+.*[A-Za-z]{3,}|[+#][^\u3400-\u9fff]*\d|\d[^\u3400-\u9fff]*[+#]|[a-z]{1,2}APP|[\u3400-\u9fff]\s+[a-z]$/.test(title.replace(/STM32|Arduino|Abstract|Chapter|ESP32|OLED|TCRT5000|STM32CubeMX|LabVIEW/gi,''))
      || /[\u3400-\u9fff]\s+[A-Za-z]{1,5}$/.test(title.replace(/\b(?:APP|PCB|MCU|WiFi|IoT|TCP|CAN|USB|SPI|UART|IIC|I2C|PWM|ADC|PID|GUI|LCD|LED|BLE|RTOS)\b/gi,''))
      || /[eo]{3,}[a-z|]{5,}/i.test(title)
      || (!/[\u3400-\u9fff]/.test(clean) && !/^[A-Za-z][A-Za-z\s-]+$/.test(clean) && clean)) {
      issues.push({line,reason:'标题文字疑似识别错误，请对照原图核对'});
    }
  }
  const unparsed=lines.filter(line=>/^第\s*\d{2,}\s*章|^\d+\s*\.\s*\d+/.test(line) && !headings.includes(line));
  for(const line of unparsed)issues.push({line,reason:'编号或层级不确定'});
  for(const line of headings) {
    const chapter=Number(line.match(/^第\s*(\d+)\s*章/)?.[1] || line.match(/^(\d+)\./)?.[1]);
    if(chapter>12) issues.push({line,reason:'章号超出合理范围，可能丢失了小数点'});
  }
  return {...normalized,headingCount:headings.length,issues};
}

export function referenceOcrScore(value = '', confidence = 0) {
  const report=referenceTextAssessment(value);
  return report.headingCount*6-report.issues.length*15+Math.min(100,Number(confidence)||0)*0.15
    +Math.min(100,(report.text.match(/设计|研究|系统|小结|现状|软件|硬件|选型|PCB/g)||[]).length)*2;
}

export function normalizeReferenceOcr(value = '') {
  const normalized=normalizeReferenceSource(value,{ocr:true});
  const lines=normalized.text.split('\n');
  const heading=line=>/^(?:第\s*[一二两三四五六七八九十\d]+\s*章|\d+(?:\.\d+){1,2}\s)/.test(line);
  const numbered=lines.filter(heading);
  // Only OCR pages with repeated page-number evidence allow glued page tails
  // to be removed. Model identifiers such as STM32/DHT11 retain their digits.
  const hasPageColumn=numbered.filter(line=>/[\u3400-\u9fff][ \t]*\d{1,3}$/.test(line) || /\s+\d{1,3}$/.test(line)).length>=3;
  const text=lines.map(line=>{
    if(!heading(line)) return line;
    line=line.replace(/\s+[a-z|.]+(?:\s*\|)?\s*$/i,tail=>/[eo]{3,}[a-z|]{3,}/i.test(tail)?'':tail);
    return hasPageColumn?line.replace(/[ \t]*[eE]{3,}[A-Za-z]*\d*$/,'').replace(/([\u3400-\u9fff])\d{1,3}$/,'$1'):line;
  }).join('\n');
  return normalizeReferenceSource(text).text;
}
