import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api, errorMessage, TYPE_META } from '../api';
import ViewerBar from '../components/ViewerBar';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const ZOOMS = [1, 1.5, 2, 2.5, 3];

// Renders one page at a time onto a canvas (cheap on low-spec laptops, and no clickable links).
export default function PdfViewer({ item, session, online, onBack, onAdmin }) {
  const [pdf, setPdf] = useState(null);
  const [page, setPage] = useState(1);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [error, setError] = useState('');
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });

  useEffect(() => {
    let cancelled = false;
    let doc = null;
    setError('');
    setPdf(null);
    api.content
      .readPdf(item.id)
      .then((data) => pdfjsLib.getDocument({ data, isEvalSupported: false, enableXfa: false }).promise)
      .then((d) => {
        doc = d;
        if (cancelled) d.destroy();
        else {
          setPdf(d);
          setPage(1);
        }
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
      if (doc) doc.destroy();
    };
  }, [item.id]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    // Height is measured without the scrollbar so zoom 100% always shows the whole page.
    const ro = new ResizeObserver(() => setStage({ w: el.offsetWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !stage.w) return undefined;
    let task = null;
    let cancelled = false;
    (async () => {
      const p = await pdf.getPage(page);
      if (cancelled) return;
      const base = p.getViewport({ scale: 1 });
      // 100% = whole page visible; zoom in to read details.
      const fit = Math.min((stage.w - 64) / base.width, (stage.h - 48) / base.height, 2.5);
      const dpr = window.devicePixelRatio || 1;
      const viewport = p.getViewport({ scale: fit * ZOOMS[zoomIndex] * dpr });
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
      task = p.render({ canvasContext: canvas.getContext('2d'), viewport });
      await task.promise;
    })().catch((e) => {
      if (!cancelled && e?.name !== 'RenderingCancelledException') setError(errorMessage(e));
    });
    return () => {
      cancelled = true;
      if (task) task.cancel();
    };
  }, [pdf, page, zoomIndex, stage]);

  useEffect(() => {
    stageRef.current?.scrollTo({ top: 0 });
  }, [page]);

  useEffect(() => {
    const onKey = (e) => {
      if (!pdf) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setPage((p) => Math.min(pdf.numPages, p + 1));
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setPage((p) => Math.max(1, p - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pdf]);

  const total = pdf?.numPages || 0;

  return (
    <div className="viewer">
      <ViewerBar
        title={item.title}
        icon={TYPE_META.pdf.icon}
        onBack={onBack}
        onAdmin={onAdmin}
        session={session}
        online={online}
      />
      <div className="pdf-stage" ref={stageRef}>
        {error ? (
          <div className="viewer-message">
            <div className="empty-icon">📡</div>
            <p>{error}</p>
          </div>
        ) : (
          <>
            {!pdf && <div className="viewer-message">Opening book…</div>}
            <canvas ref={canvasRef} className="pdf-canvas" style={{ display: pdf ? 'block' : 'none' }} />
          </>
        )}
      </div>
      {pdf && (
        <div className="pdf-controls">
          <button className="btn btn-big" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ◀ Back
          </button>
          <span className="pdf-page">
            Page {page} of {total}
          </span>
          <button className="btn btn-big" disabled={page >= total} onClick={() => setPage(page + 1)}>
            Next ▶
          </button>
          <span className="pdf-zoom">
            <button className="btn" disabled={zoomIndex === 0} onClick={() => setZoomIndex(zoomIndex - 1)} aria-label="Smaller">
              ➖
            </button>
            <button
              className="btn"
              disabled={zoomIndex === ZOOMS.length - 1}
              onClick={() => setZoomIndex(zoomIndex + 1)}
              aria-label="Bigger"
            >
              ➕
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
