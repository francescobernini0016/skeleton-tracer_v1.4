// sketch.js — detection + diagnostics per TraceSkeleton (aggiornato con fallback vettoriale)
(function () {
  new p5(function (p) {
    const CANVAS_W = 1000;
    const CANVAS_H = 600;
    const BASELINE_Y_FRAC = 0.7;

    // STATE
    let loadedFont = null;
    let lettersPolylines = [];
    let inputText = "Hello";
    let fontSize = 200;
    let letterSpacing = 10;
    let strokeW = 3;

    // UI refs
    let ui_textInput, ui_sizeSlider, ui_spacingSlider, ui_weightSlider, ui_fontFile, ui_exportBtn;

    // canvas ref
    let mainCanvas;

    // tracer cache
    let _cachedTracer = null;
    let _tracerLoading = false;

    p.setup = function () {
      p.pixelDensity(1);
      mainCanvas = p.createCanvas(CANVAS_W, CANVAS_H);
      const canvasArea = document.getElementById("canvas-area");
      if (canvasArea) mainCanvas.parent(canvasArea);

      tryFindTTFReferences();
      tryCreateCommonAliases();

      setupUI();
      rebuildPolylines();
      setupResizer();

      console.log("Initial tracer quick-check:", !!(window.TraceSkeleton || window.traceSkeleton || window.trace_skeleton));
      logTracerCandidates();
    };

    p.draw = function () {
      p.background(255);
      p.noFill();
      p.stroke(0);
      p.strokeWeight(strokeW);

      for (const L of lettersPolylines) {
        for (const poly of L.polylines) {
          if (!poly || poly.length < 2) continue;
          p.beginShape();
          for (let pt of poly) p.vertex(pt[0], pt[1]);
          p.endShape();
        }
      }
    };

    function setupUI() {
      const panel = p.select("#ui-panel-area") || p.createDiv().id("ui-panel-area");
      panel.addClass("ui-panel");

      p.createDiv("Font (.otf / .ttf)").parent(panel).addClass("ui-title");
      ui_fontFile = p.createFileInput(handleFontUpload);
      ui_fontFile.attribute("accept", ".otf,.ttf");
      ui_fontFile.parent(panel);

      p.createDiv("Text").parent(panel).addClass("ui-subtitle");
      ui_textInput = p.createInput(inputText);
      ui_textInput.parent(panel);
      ui_textInput.input(() => { inputText = ui_textInput.value(); rebuildPolylines(); });

      p.createDiv("Font size").parent(panel).addClass("ui-subtitle");
      ui_sizeSlider = p.createSlider(40, 400, fontSize, 1);
      ui_sizeSlider.parent(panel);
      const sizeSpan = p.createSpan(fontSize + " px");
      sizeSpan.parent(panel).addClass("ui-span");
      ui_sizeSlider.input(() => { fontSize = ui_sizeSlider.value(); sizeSpan.html(fontSize + " px"); rebuildPolylines(); });

      p.createDiv("Letter spacing").parent(panel).addClass("ui-subtitle");
      ui_spacingSlider = p.createSlider(0, 80, letterSpacing, 1);
      ui_spacingSlider.parent(panel);
      const spSpan = p.createSpan(letterSpacing + " px");
      spSpan.parent(panel).addClass("ui-span");
      ui_spacingSlider.input(() => { letterSpacing = ui_spacingSlider.value(); spSpan.html(letterSpacing + " px"); rebuildPolylines(); });

      p.createDiv("Stroke weight").parent(panel).addClass("ui-subtitle");
      ui_weightSlider = p.createSlider(1, 12, strokeW, 1);
      ui_weightSlider.parent(panel);
      ui_weightSlider.input(() => { strokeW = ui_weightSlider.value(); });

      ui_exportBtn = p.createButton("Export SVG");
      ui_exportBtn.parent(panel);
      ui_exportBtn.addClass("ui-button");
      ui_exportBtn.mousePressed(() => exportSVG());
    }

    function handleFontUpload(file) {
      if (!file || !file.data) return;
      const ok = /\.otf$/i.test(file.name) || /\.ttf$/i.test(file.name) || file.subtype === "opentype" || file.subtype === "truetype";
      if (!ok) { alert("Carica un file .otf o .ttf"); return; }
      loadedFont = p.loadFont(file.data, () => {
        console.log("Font caricato:", file.name);
        rebuildPolylines();
      }, (err) => {
        console.warn("Errore caricamento font:", err);
        loadedFont = null;
        rebuildPolylines();
      });
    }

    function tryCreateCommonAliases() {
      if (window.traceSkeleton && !window.TraceSkeleton) {
        window.TraceSkeleton = window.traceSkeleton;
        console.log("Aliased window.traceSkeleton -> window.TraceSkeleton");
      }
      if (window.trace_skeleton && !window.TraceSkeleton) {
        window.TraceSkeleton = window.trace_skeleton;
        console.log("Aliased window.trace_skeleton -> window.TraceSkeleton");o
      }
      if (window.skeletonTracing && !window.TraceSkeleton) {
        window.TraceSkeleton = window.skeletonTracing;
        console.log("Aliased window.skeletonTracing -> window.TraceSkeleton");
      }
    }

    function logTracerCandidates() {
      const keys = Object.keys(window).filter(k => /trace|skeleton|Skeleton/i.test(k)).sort();
      console.log("Window keys matching trace|skeleton:", keys);
      keys.forEach(k => {
        try {
          const v = window[k];
          console.log(k, typeof v, v && (v.fromCanvas ? "has fromCanvas" : (v.load ? "has load" : (v.trace ? "has trace" : (v.fromBoolArray ? "has fromBoolArray" : "")))));
        } catch (e) {
          console.log(k, "error reading");
        }
      });
    }

    function tryFindTTFReferences() {
      try {
        const sheets = [...document.styleSheets];
        sheets.forEach((ss) => {
          try {
            const rules = ss.cssRules ? [...ss.cssRules] : [];
            rules.forEach((r) => {
              if (r.cssText && r.cssText.toLowerCase().includes(".ttf")) {
                console.warn("Found .ttf reference in stylesheet:", ss.href || "<inline>", r.cssText);
              }
            });
          } catch (e) {
            // cross-origin sheet may throw; ignore
          }
        });
      } catch (e) {}
    }

    async function getTracer() {
      if (_cachedTracer) return _cachedTracer;

      const candidateNames = Object.keys(window).filter(k => /trace|skeleton|Skeleton/i.test(k));
      for (const name of candidateNames) {
        try {
          const v = window[name];
          if (!v) continue;
          if (typeof v.fromCanvas === "function") { _cachedTracer = v; return _cachedTracer; }
          if (v.default && typeof v.default.fromCanvas === "function") { _cachedTracer = v.default; return _cachedTracer; }
          if (typeof v.load === "function") {
            try {
              _tracerLoading = true;
              const loaded = await v.load();
              _tracerLoading = false;
              if (loaded && typeof loaded.fromCanvas === "function") { _cachedTracer = loaded; return _cachedTracer; }
              if (loaded) { _cachedTracer = loaded; return _cachedTracer; }
            } catch (err) { _tracerLoading = false; console.warn("getTracer load failed", err); }
          }
          if (typeof v.trace === "function" || typeof v.fromBoolArray === "function" || typeof v.traceSkeleton === "function") { _cachedTracer = v; return _cachedTracer; }
        } catch (e) {}
      }

      const knowns = [window.TraceSkeleton, window.traceSkeleton, window.trace_skeleton, window.skeletonTracing];
      for (const c of knowns) {
        if (c && typeof c.fromCanvas === "function") { _cachedTracer = c; return _cachedTracer; }
        if (c && typeof c.load === "function") {
          try {
            _tracerLoading = true;
            const loaded = await c.load();
            _tracerLoading = false;
            if (loaded && typeof loaded.fromCanvas === "function") { _cachedTracer = loaded; return _cachedTracer; }
            if (loaded) { _cachedTracer = loaded; return _cachedTracer; }
          } catch (e) { _tracerLoading = false; }
        }
      }

      return null;
    }

    // call tracer trying different entrypoints (sync)
    function callTracerOnGraphicsSync(tracer, g) {
      if (!tracer) return null;

      if (typeof tracer.fromCanvas === "function") {
        try { console.log("Calling tracer.fromCanvas(canvas)..."); return tracer.fromCanvas(g.canvas); } catch (e) { console.warn("tracer.fromCanvas threw:", e); }
      }
      if (typeof tracer.trace === "function") {
        try { console.log("Calling tracer.trace(canvas)..."); return tracer.trace(g.canvas); } catch (e) { console.warn("tracer.trace threw:", e); }
      }
      if (typeof tracer.traceSkeleton === "function") {
        try { console.log("Calling tracer.traceSkeleton(canvas)..."); return tracer.traceSkeleton(g.canvas); } catch (e) { console.warn("tracer.traceSkeleton threw:", e); }
      }

      if (typeof tracer.fromBoolArray === "function") {
        try {
          const { w, h, arr, count } = getBoolArrayFromGraphics(g);
          console.log(`Calling tracer.fromBoolArray with arr,w,h (w=${w},h=${h},len=${arr.length},count=${count})`);
          try { const res = tracer.fromBoolArray(arr, w, h); if (res) return res; } catch (e) { console.warn("fromBoolArray(arr,w,h) failed:", e); }
          try { const res = tracer.fromBoolArray(w, h, arr); if (res) return res; } catch (e) { console.warn("fromBoolArray(w,h,arr) failed:", e); }
          try { const res = tracer.fromBoolArray(arr); if (res) return res; } catch (e) { console.warn("fromBoolArray(arr) failed:", e); }
        } catch (e) { console.warn("fromBoolArray attempts threw:", e); }
      }

      if (tracer.default) {
        return callTracerOnGraphicsSync(tracer.default, g);
      }

      return null;
    }
 
    function getBoolArrayFromGraphics(g) {
      g.loadPixels();
      const w = g.width, h = g.height;
      const arr = new Uint8Array(w * h);
      let count = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          const r = g.pixels[idx], gr = g.pixels[idx + 1], b = g.pixels[idx + 2];
          const lum = 0.299 * r + 0.587 * gr + 0.114 * b;
          const v = lum > 127 ? 1 : 0;
          arr[y * w + x] = v;
          if (v) count++;
        }
      }
      return { w, h, arr, count };
    }

    // rebuilt with vector fallback if raster draw fails
    async function rebuildPolylines() {
      lettersPolylines = [];
      if (!inputText) return;

      p.textSize(fontSize);
      if (loadedFont) p.textFont(loadedFont);

      let penX = 40;
      const baselineY = CANVAS_H * BASELINE_Y_FRAC;

      const tracer = await getTracer();
      const hasTrace = !!(tracer && (typeof tracer.fromCanvas === "function" || typeof tracer.trace === "function" || typeof tracer.fromBoolArray === "function" || typeof tracer.traceSkeleton === "function"));
      console.log("rebuildPolylines: TraceSkeleton available?", hasTrace, " tracer:", tracer);

      for (let i = 0; i < inputText.length; i++) {
        const ch = inputText[i];
        if (ch === "\n") continue;

        let bounds;
        if (loadedFont && loadedFont.textBounds) {
          bounds = loadedFont.textBounds(ch, penX, baselineY, fontSize);
        } else {
          const w = p.textWidth(ch);
          bounds = { x: penX, y: baselineY - fontSize * 0.8, w: w, h: fontSize };
        }

        if (hasTrace) {
          // canvas temporaneo per singolo glifo
          const gw = Math.max(2, Math.ceil(bounds.w));
          const gh = Math.max(2, Math.ceil(bounds.h));
          let gCanvas = p.createGraphics(gw, gh);
          gCanvas.pixelDensity(1);

          // nero come sfondo
          gCanvas.background(0);

          // testo bianco
          gCanvas.fill(255);
          gCanvas.noStroke();

          // centra la lettera nel canvas
          if (loadedFont) gCanvas.textFont(loadedFont);
          gCanvas.textSize(fontSize);
          gCanvas.textAlign(p.LEFT, p.BASELINE);

          // disegna la lettera in bianco
          gCanvas.text(ch, 0, gh * 0.8);

          // (debug) controlla se ci sono pixel bianchi
          gCanvas.loadPixels();
          let whitePixels = 0;
          for (let pi = 0; pi < gCanvas.pixels.length; pi += 4) {
            if (gCanvas.pixels[pi] > 200) whitePixels++;
          }
          console.log(`Glyph '${ch}': whitePixels=${whitePixels}`);

          // ora passalo al tracer
          let sk = null;
          try {
            sk = tracer.fromCanvas(gCanvas.elt);
          } catch (e) {
            console.warn("tracer.fromCanvas threw:", e);
            sk = null;
          }

          if (!sk || !sk.polylines || !sk.polylines.length) {
            console.warn("TraceSkeleton returned empty for char:", ch);
            lettersPolylines.push({ char: ch, polylines: fallbackPoints(ch, bounds, penX, baselineY) });
          } else {
            // offset per posizionare il glifo nella posizione corretta sul canvas principale
            const absPolys = (sk.polylines || []).map(poly => poly.map(pt => [pt[0] + penX, pt[1] + baselineY - fontSize * 0.8]));
            lettersPolylines.push({ char: ch, polylines: absPolys });
          }

        } else if (loadedFont && typeof loadedFont.textToPoints === "function") {
          const sampleF = Math.max(0.02, Math.min(0.5, 0.08 * (200 / fontSize)));
          const pts = loadedFont.textToPoints(ch, penX, baselineY, fontSize, { sampleFactor: sampleF, simplifyThreshold: 0 });
          const poly = pts.map(ppt => [ppt.x, ppt.y]);
          lettersPolylines.push({ char: ch, polylines: [poly] });
        } else {
          const px = bounds.x, py = bounds.y;
          const rectPoly = [[px,py],[px+bounds.w,py],[px+bounds.w,py+bounds.h],[px,py+bounds.h],[px,py]];
          lettersPolylines.push({ char: ch, polylines: [rectPoly] });
        }

        penX += p.textWidth(ch) + letterSpacing;
      }
    }

    function fallbackPoints(ch, bounds, penX, baselineY) {
      if (loadedFont && typeof loadedFont.textToPoints === "function") {
        const sampleF = Math.max(0.02, Math.min(0.5, 0.08 * (200 / fontSize)));
        const pts = loadedFont.textToPoints(ch, penX, baselineY, fontSize, { sampleFactor: sampleF, simplifyThreshold: 0 });
        const poly = pts.map(ppt => [ppt.x, ppt.y]);
        return [poly];
      } else {
        const px = bounds.x, py = bounds.y;
        return [[[px,py],[px+bounds.w,py],[px+bounds.w,py+bounds.h],[px,py+bounds.h],[px,py]]];
      }
    }

    function exportSVG() {
      const w = CANVAS_W, h = CANVAS_H;
      const sw = ui_weightSlider ? ui_weightSlider.value() : strokeW;
      let out = [];
      out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
      out.push(`<g fill="none" stroke="black" stroke-width="${sw}">`);
      lettersPolylines.forEach((L,i) => {
        const safeId = `${L.char||"space"}_${i}`.replace(/[^a-zA-Z0-9_-]/g,"_");
        out.push(`<g id="char_${safeId}">`);
        L.polylines.forEach(poly => {
          if (!poly || poly.length < 2) return;
          const d = "M " + poly.map(p=>`${p[0]},${p[1]}`).join(" L ");
          out.push(`<path d="${d}" />`);
        });
        out.push(`</g>`);
      });
      out.push(`</g></svg>`);
      const blob = new Blob([out.join("\n")], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "text_skeleton.svg";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function setupResizer() {
      const resizer = document.querySelector(".resizer");
      const panel = document.getElementById("ui-panel-area");
      if (!resizer || !panel) return;
      let dragging = false;
      resizer.addEventListener("mousedown", (e) => { dragging = true; document.body.classList.add("resizing"); e.preventDefault(); });
      window.addEventListener("mousemove", (e) => { if (!dragging) return; let newW = Math.min(540, Math.max(220, window.innerWidth - e.clientX)); panel.style.width = newW + "px"; });
      window.addEventListener("mouseup", () => { if (dragging) { dragging = false; document.body.classList.remove("resizing"); } });
    }

    // debug helper (retries)
    async function getTracer() {
      if (_cachedTracer) return _cachedTracer;
      return await (async () => {
        const candidateNames = Object.keys(window).filter(k => /trace|skeleton|Skeleton/i.test(k));
        for (const name of candidateNames) {
          try {
            const v = window[name];
            if (!v) continue;
            if (typeof v.fromCanvas === "function") { _cachedTracer = v; return _cachedTracer; }
            if (v.default && typeof v.default.fromCanvas === "function") { _cachedTracer = v.default; return _cachedTracer; }
            if (typeof v.load === "function") {
              try { const loaded = await v.load(); if (loaded && typeof loaded.fromCanvas === "function") { _cachedTracer = loaded; return _cachedTracer; } if (loaded) { _cachedTracer = loaded; return _cachedTracer; } } catch (e) {}
            }
            if (typeof v.trace === "function" || typeof v.fromBoolArray === "function" || typeof v.traceSkeleton === "function") { _cachedTracer = v; return _cachedTracer; }
          } catch (e){}
        }
        return null;
      })();
    }

    window.__skeleton_tool = { rebuild: rebuildPolylines, export: exportSVG, getTracer };

  }); // end new p5
})(); // end IIFE
