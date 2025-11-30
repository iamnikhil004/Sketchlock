// src/components/SketchAuth.jsx
import React, { useRef, useState, useEffect } from 'react';
const RESAMPLE_N = 64; // number of points to compare
const SAVE_KEY = 'sketch_template_v1';

// helpers (same as before)
function getPos(e, rect) {
  if (e.touches) {
    return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
  }
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
function centroid(points) {
  const n = points.length;
  const sum = points.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / n, y: sum.y / n };
}
function boundingBox(points) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
function normalize(points, size = 200) {
  if (points.length === 0) return [];
  const c = centroid(points);
  const translated = points.map(p => ({ x: p.x - c.x, y: p.y - c.y }));
  const box = boundingBox(translated);
  const w = box.maxX - box.minX || 1;
  const h = box.maxY - box.minY || 1;
  const scale = size / Math.max(w, h);
  return translated.map(p => ({ x: p.x * scale, y: p.y * scale }));
}
function pathLength(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i-1].x;
    const dy = points[i].y - points[i-1].y;
    d += Math.hypot(dx, dy);
  }
  return d;
}
function resample(points, n = RESAMPLE_N) {
  if (points.length === 0) return [];
  points = points.slice(); // copy because we may splice
  const I = pathLength(points) / (n - 1);
  const newPts = [points[0]];
  let D = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i-1], curr = points[i];
    const d = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    if ((D + d) >= I) {
      const t = (I - D) / d;
      const nx = prev.x + t * (curr.x - prev.x);
      const ny = prev.y + t * (curr.y - prev.y);
      const newP = { x: nx, y: ny };
      newPts.push(newP);
      points.splice(i, 0, newP);
      D = 0;
    } else {
      D += d;
    }
  }
  while (newPts.length < n) newPts.push(newPts[newPts.length - 1]);
  return newPts.slice(0, n);
}
function avgDistance(a, b) {
  if (a.length !== b.length) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
  return s / a.length;
}
function scoreMatch(pointsA, pointsB) {
  const na = resample(normalize(pointsA));
  const nb = pointsB; // template already normalized+resampled when saved
  return avgDistance(na, nb);
}

// draw a polyline on ctx with given style
function drawPolyline(ctx, pts, { stroke = '#111', lineWidth = 4, alpha = 1 } = {}) {
  if (!pts || pts.length < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = stroke;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();
}

export default function SketchAuth() {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [points, setPoints] = useState([]);
  const [message, setMessage] = useState('');
  const [threshold, setThreshold] = useState(18);
  const [templateExists, setTemplateExists] = useState(!!localStorage.getItem(SAVE_KEY));
  const [showOverlay, setShowOverlay] = useState(true);

  useEffect(() => { draw(); /* eslint-disable-next-line */ }, [points, showOverlay]);

  function clearCanvas() {
    setPoints([]);
    setMessage('');
    const ctx = canvasRef.current.getContext('2d');
    ctx.clearRect(0,0,canvasRef.current.width, canvasRef.current.height);
  }

  function start(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const p = getPos(e, rect);
    setPoints([{ x: p.x, y: p.y }]);
    setDrawing(true);
    setMessage('');
    e.preventDefault?.();
  }
  function move(e) {
    if (!drawing) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const p = getPos(e, rect);
    setPoints(prev => [...prev, { x: p.x, y: p.y }]);
    e.preventDefault?.();
  }
  function end() { setDrawing(false); }

  function draw() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0,0,c.width,c.height);

    // draw saved overlay first (if enabled)
    if (showOverlay) {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        try {
          const saved = JSON.parse(raw); // saved is normalized+resampled coords (centered)
          // to show overlay in canvas space, we need to map normalized saved coords back
          // We'll compute a transform that centers and scales saved coords into canvas center
          const centerX = c.width / 2, centerY = c.height / 2;
          // compute bbox of saved coords
          const xs = saved.map(p => p.x), ys = saved.map(p => p.y);
          const minX = Math.min(...xs), maxX = Math.max(...xs);
          const minY = Math.min(...ys), maxY = Math.max(...ys);
          const w = maxX - minX || 1, h = maxY - minY || 1;
          const scale = Math.min((c.width * 0.6) / w, (c.height * 0.6) / h); // fit into 60% area
          const offsetX = centerX - ((minX + maxX) / 2) * scale;
          const offsetY = centerY - ((minY + maxY) / 2) * scale;
          const mapped = saved.map(p => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY }));
          // draw mapped overlay lightly
          drawPolyline(ctx, mapped, { stroke: '#0077ff', lineWidth: 3, alpha: 0.35 });
        } catch {}
      }
    }

    // draw current stroke
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111';
    if (points.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    }
  }

  function saveTemplate() {
    if (points.length < 8) { setMessage('Draw a longer pattern before saving.'); return; }
    const norm = resample(normalize(points));
    localStorage.setItem(SAVE_KEY, JSON.stringify(norm));
    setTemplateExists(true);
    setMessage('Template saved ✔️');
    draw();
  }

  function verify() {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { setMessage('No template saved.'); return; }
    if (points.length < 3) { setMessage('Draw something to verify.'); return; }
    const template = JSON.parse(raw);
    const sc = scoreMatch(points, template);
    const ok = sc <= threshold;
    setMessage(ok ? `Matched (score ${sc.toFixed(2)}) — Access granted ✅` : `Not matched (score ${sc.toFixed(2)}) — Try again ❌`);
  }

  function removeTemplate() {
    localStorage.removeItem(SAVE_KEY);
    setTemplateExists(false);
    setMessage('Template removed.');
    draw();
  }

  // replay animation of saved template mapped to canvas coordinates
  function replayTemplate() {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { setMessage('No template saved to replay.'); return; }
    const saved = JSON.parse(raw);
    const c = canvasRef.current;
    const ctx = c.getContext('2d');

    // compute mapping same as in draw()
    const centerX = c.width / 2, centerY = c.height / 2;
    const xs = saved.map(p => p.x), ys = saved.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = maxX - minX || 1, h = maxY - minY || 1;
    const scale = Math.min((c.width * 0.6) / w, (c.height * 0.6) / h);
    const offsetX = centerX - ((minX + maxX) / 2) * scale;
    const offsetY = centerY - ((minY + maxY) / 2) * scale;
    const mapped = saved.map(p => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY }));

    // cancel previous animation if any
    if (animRef.current) cancelAnimationFrame(animRef.current);
    let i = 1;
    function step() {
      ctx.clearRect(0,0,c.width,c.height);
      // draw overlay faintly behind
      if (showOverlay) draw(); // draws overlay + current points (but current points empty usually)
      // draw progressive line
      if (i > 1) drawPolyline(ctx, mapped.slice(0, i), { stroke: '#ff6600', lineWidth: 4, alpha: 0.95 });
      i++;
      if (i <= mapped.length) animRef.current = requestAnimationFrame(step);
      else animRef.current = null;
    }
    animRef.current = requestAnimationFrame(step);
  }

  // export template file
  function exportTemplate() {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { setMessage('No template to export.'); return; }
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sketch-template.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setMessage('Template exported.');
  }

  // import template file
  function importTemplate(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed) || parsed.length < 8) throw new Error('Invalid template');
        localStorage.setItem(SAVE_KEY, JSON.stringify(parsed));
        setTemplateExists(true);
        setMessage('Template imported.');
        draw();
      } catch (err) {
        setMessage('Invalid template file.');
      }
    };
    reader.readAsText(file);
  }

  return (
    <div style={{ padding: 12, fontFamily: 'Arial, sans-serif', maxWidth: 980 }}>
      <h2>Sketch Password — Demo</h2>
      <div style={{ display:'flex', gap:12 }}>
        <div style={{ border:'1px solid #ddd', width: 720, height: 480, position:'relative' }}>
          <canvas
            ref={canvasRef}
            width={720}
            height={480}
            style={{ touchAction: 'none', background:'#fff', display:'block' }}
            onMouseDown={(e)=>start(e)}
            onMouseMove={(e)=>move(e)}
            onMouseUp={()=>end()}
            onMouseLeave={()=>end()}
            onTouchStart={(e)=>start(e)}
            onTouchMove={(e)=>move(e)}
            onTouchEnd={()=>end()}
          />
        </div>

        <div style={{ width: 240 }}>
          <div style={{ marginBottom: 8 }}>
            <button onClick={saveTemplate} style={{ marginRight:8 }}>Save Pattern</button>
            <button onClick={verify} style={{ marginRight:8 }}>Verify</button>
            <button onClick={clearCanvas} style={{ marginRight:8 }}>Clear</button>
          </div>

          <div style={{ marginBottom:8 }}>
            <label style={{ display:'block', marginBottom:6 }}>
              Threshold: <input type="range" min="5" max="60" value={threshold} onChange={(e)=>setThreshold(Number(e.target.value))} />
            </label>
            <div style={{ fontSize:12, color:'#666' }}>Lower = stricter</div>
          </div>

          <div style={{ marginBottom:8 }}>
            <strong>Template:</strong> {templateExists ? 'Saved' : 'Not saved'}
            {templateExists && <button onClick={removeTemplate} style={{ display:'block', marginTop:6 }}>Remove</button>}
          </div>

          <div style={{ marginBottom:8 }}>
            <label style={{ display:'flex', alignItems:'center', gap:8 }}>
              <input type="checkbox" checked={showOverlay} onChange={(e)=>setShowOverlay(e.target.checked)} /> Show saved overlay
            </label>
            <div style={{ display:'flex', gap:8, marginTop:6 }}>
              <button onClick={replayTemplate}>Replay</button>
              <button onClick={exportTemplate}>Export</button>
              <label style={{ display:'inline-block', cursor:'pointer', border:'1px solid #ddd', padding:'6px 8px', borderRadius:6 }}>
                Import
                <input type="file" accept="application/json" style={{ display:'none' }} onChange={(e)=>importTemplate(e.target.files[0])} />
              </label>
            </div>
          </div>

          <div style={{ marginTop:12, padding:8, border:'1px solid #eee', minHeight:80 }}>
            <div style={{ fontSize:14 }}>{message}</div>
            <div style={{ fontSize:12, color:'#888', marginTop:6 }}>
              Tips: draw with consistent stroke, test a few times, adjust threshold as needed. Use overlay to compare visually.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
