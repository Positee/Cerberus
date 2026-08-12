import { useEffect, useRef } from 'react';

/**
 * Cerberus, drawn as layered vector geometry so each head can be posed at runtime.
 *
 * Every bilateral feature is authored once as a function of `s` (+1 = the dog's
 * left, -1 = its right) so both sides share one source of truth and pupils can be
 * translated with the same sign on either eye.
 */

type HeadSpec = {
  uid: string;
  x: number;
  y: number;
  scale: number;
  baseRot: number;
  /** Per-head lerp factor. Staggering these makes the heads arrive out of sync. */
  ease: number;
  /** How much this head commits to the turn. The center head leads. */
  yaw: number;
  blinkDelay: string;
};

const HEADS: HeadSpec[] = [
  { uid: 'l', x: 352, y: 384, scale: 0.8, baseRot: -14, ease: 0.048, yaw: 0.72, blinkDelay: '2.4s' },
  { uid: 'r', x: 648, y: 384, scale: 0.8, baseRot: 14, ease: 0.039, yaw: 0.72, blinkDelay: '5.1s' },
  { uid: 'c', x: 500, y: 310, scale: 1, baseRot: 0, ease: 0.085, yaw: 1, blinkDelay: '0s' },
];

/** Neck base in local head coordinates. Heads pivot here, not around their center. */
const PIVOT_Y = 230;

/* Local head space: origin sits between the eyes. Ear tips are at y = -146, the
   chin at y = 138, and the neck runs from y 110 down to 242. The skull is one
   silhouette: broad cranium, cheeks, then a flare back out into the jaw, so the
   snarl terminates the head instead of floating on the neck. */

const ear = (s: number) =>
  `M ${-68 * s},-58 C ${-80 * s},-88 ${-92 * s},-118 ${-96 * s},-146 C ${-70 * s},-132 ${-46 * s},-108 ${-32 * s},-84 Z`;
const earInner = (s: number) =>
  `M ${-66 * s},-66 C ${-76 * s},-90 ${-85 * s},-112 ${-88 * s},-133 C ${-68 * s},-121 ${-50 * s},-102 ${-39 * s},-85 Z`;
const cheek = (s: number) =>
  `M ${-72 * s},-8 C ${-74 * s},20 ${-64 * s},46 ${-46 * s},64 L ${-32 * s},54 C ${-44 * s},38 ${-50 * s},18 ${-50 * s},-4 Z`;
const brow = (s: number) =>
  `M ${-70 * s},-32 C ${-50 * s},-24 ${-28 * s},-14 ${-17 * s},-4 L ${-19 * s},8 C ${-35 * s},-2 ${-55 * s},-10 ${-71 * s},-14 Z`;
const socket = (s: number) => `M ${-62 * s},-10 L ${-20 * s},4 L ${-25 * s},20 L ${-57 * s},10 Z`;
const slit = (s: number) => `M ${-57 * s},-4 L ${-25 * s},8 L ${-29 * s},18 L ${-53 * s},9 Z`;
const circuit = (s: number) => `M ${-64 * s},14 L ${-55 * s},26 L ${-55 * s},44 M ${-55 * s},26 L ${-42 * s},26`;
const rimLight = (s: number) =>
  `M ${-66 * s},-62 C ${-76 * s},-42 ${-78 * s},-16 ${-73 * s},4 C ${-68 * s},28 ${-56 * s},48 ${-40 * s},58`;

/* Teeth are thin, curved and dim. At the size this renders, wide bright teeth
   merge into one white block. Upper and lower canines are offset on x so they
   interleave in the snarl instead of forming a solid band. */
const fangUpper = (s: number) =>
  `M ${-21.5 * s},98 C ${-21 * s},105 ${-19.6 * s},111 ${-17.6 * s},116 ` +
  `C ${-16.4 * s},110 ${-15.6 * s},103.5 ${-15.3 * s},98 Z`;
const fangUpperSmall = (s: number) =>
  `M ${-9 * s},98 C ${-8.6 * s},102 ${-7.8 * s},105 ${-6.8 * s},107.5 ` +
  `C ${-6 * s},104.5 ${-5.4 * s},101 ${-5.2 * s},98 Z`;
const fangLower = (s: number) =>
  `M ${-16 * s},128 C ${-15.4 * s},122 ${-14 * s},117.5 ${-12 * s},114 ` +
  `C ${-11 * s},118.5 ${-10.6 * s},123 ${-10.6 * s},128 Z`;

const SKULL =
  'M 0,-98 C -32,-98 -58,-86 -68,-64 C -77,-44 -79,-18 -73,4 ' +
  'C -68,30 -58,52 -44,66 C -40,88 -34,112 -18,130 C -10,138 10,138 18,130 ' +
  'C 34,112 40,88 44,66 C 58,52 68,30 73,4 ' +
  'C 79,-18 77,-44 68,-64 C 58,-86 32,-98 0,-98 Z';
const SKULL_PLATE = 'M -50,-72 C -28,-88 28,-88 50,-72 C 46,-52 34,-38 0,-34 C -34,-38 -46,-52 -50,-72 Z';
const MUZZLE = 'M -30,28 C -32,50 -31,72 -29,90 L 29,90 C 31,72 32,50 30,28 C 16,22 -16,22 -30,28 Z';
const NOSE = 'M -16,56 C -16,48 16,48 16,56 C 16,70 8,80 0,80 C -8,80 -16,70 -16,56 Z';
const MOUTH = 'M -31,91 C -15,86 15,86 31,91 C 29,113 16,129 0,129 C -16,129 -29,113 -31,91 Z';
const GUM = 'M -31,91 C -15,86 15,86 31,91 L 29,101 C 15,96 -15,96 -29,101 Z';
const NECK = 'M -40,110 C -47,146 -57,194 -60,242 L 60,242 C 57,194 47,146 40,110 Z';
/** Fur tufts at the base of the neck. Shallow, or they read as a skirt. */
const MANE =
  'M -60,206 L -68,232 L -46,222 L -50,240 L -26,228 L -23,246 L 0,232 L 23,246 L 26,228 L 50,240 L 46,222 L 68,232 L 60,206 Z';

type HeadProps = {
  spec: HeadSpec;
  setHead: (el: SVGGElement | null) => void;
  setFace: (el: SVGGElement | null) => void;
  setPupil: (side: 0 | 1, el: SVGGElement | null) => void;
};

function CerberusHead({ spec, setHead, setFace, setPupil }: HeadProps) {
  const { uid, x, y, scale, baseRot, blinkDelay } = spec;

  return (
    <g
      ref={setHead}
      // Static pose. The rAF loop overwrites this, but it is also the final
      // rendering for anyone on prefers-reduced-motion.
      transform={`translate(${x} ${y}) scale(${scale}) rotate(${baseRot} 0 ${PIVOT_Y})`}
    >
      <path d={NECK} fill="url(#cbNeck)" />
      <path d={MANE} fill="#0d0616" />
      <path d={MANE} fill="none" stroke="#9d6bff" strokeWidth={1} opacity={0.2} />

      {([1, -1] as const).map((s) => (
        <g key={`ear${s}`} className="cb-ear" style={{ animationDelay: `${s > 0 ? 0 : 1.7}s` }}>
          <path d={ear(s)} fill="#100819" />
          <path d={earInner(s)} fill="#3d1259" opacity={0.85} />
          <path d={ear(s)} fill="none" stroke="#9d6bff" strokeWidth={1.4} opacity={0.3} />
        </g>
      ))}

      <path d={SKULL} fill="url(#cbSkull)" />
      <path d={SKULL_PLATE} fill="url(#cbPlate)" />
      <path d={SKULL_PLATE} fill="none" stroke="#9d6bff" strokeWidth={0.9} opacity={0.2} />

      {/* Everything below reacts to the cursor a second time, which is what sells
          the turn: features slide across the skull while the skull itself rotates. */}
      <g ref={setFace}>
        {([1, -1] as const).map((s) => (
          <g key={`cheek${s}`}>
            <path d={cheek(s)} fill="url(#cbPlate)" opacity={0.9} />
            <path d={circuit(s)} fill="none" stroke="#9d6bff" strokeWidth={1} opacity={0.3} strokeLinecap="round" />
          </g>
        ))}

        <path d={MUZZLE} fill="url(#cbMuzzle)" />
        <path d={NOSE} fill="#080310" />
        <ellipse cx={-6} cy={61} rx={2.8} ry={3.8} fill="#241a35" />
        <ellipse cx={6} cy={61} rx={2.8} ry={3.8} fill="#241a35" />

        <path d={MOUTH} fill="url(#cbMouth)" />
        <path d={GUM} fill="#2a0a20" />
        {([1, -1] as const).map((s) => (
          <g key={`teeth${s}`} fill="url(#cbTooth)" opacity={0.92}>
            <path d={fangUpper(s)} />
            <path d={fangUpperSmall(s)} />
            <path d={fangLower(s)} />
          </g>
        ))}

        {([1, -1] as const).map((s, i) => (
          <g key={`eye${s}`}>
            <path d={brow(s)} fill="#100a19" />
            <path d={socket(s)} fill="#08020f" />
            <clipPath id={`cb-clip-${uid}-${i}`}>
              <path d={slit(s)} />
            </clipPath>
            <path d={slit(s)} fill="url(#cbEye)" />
            <g clipPath={`url(#cb-clip-${uid}-${i})`}>
              <g ref={(el) => setPupil(i as 0 | 1, el)}>
                <ellipse cx={-41 * s} cy={6} rx={5.5} ry={8} fill="#fff2f2" />
              </g>
            </g>
            <path d={slit(s)} className="cb-eyeglow" fill="#ff4d5e" filter="url(#cbGlow)" opacity={0.7} />
            {/* Lid drops from the top of the socket for the blink. */}
            <path d={socket(s)} className="cb-lid" style={{ animationDelay: blinkDelay }} fill="#100a19" />
          </g>
        ))}

        {/* Key light on the animal's right edge, a cold bounce on the left. */}
        {([1, -1] as const).map((s) => (
          <path
            key={`rim${s}`}
            d={rimLight(s)}
            fill="none"
            stroke={s > 0 ? '#c9a4ff' : '#9d6bff'}
            strokeWidth={s > 0 ? 1.4 : 2}
            strokeLinecap="round"
            opacity={s > 0 ? 0.22 : 0.5}
          />
        ))}
      </g>
    </g>
  );
}

export default function CerberusBeast() {
  const svgRef = useRef<SVGSVGElement>(null);
  const headEls = useRef<(SVGGElement | null)[]>([]);
  const faceEls = useRef<(SVGGElement | null)[]>([]);
  const pupilEls = useRef<(SVGGElement | null)[]>([]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const target = { x: 0, y: 0 };
    const cur = HEADS.map(() => ({ x: 0, y: 0 }));
    let hasPointer = false;
    let frame = 0;

    const clamp = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

    const onMove = (event: PointerEvent) => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      target.x = clamp((event.clientX - rect.left - rect.width / 2) / (rect.width * 0.62));
      target.y = clamp((event.clientY - rect.top - rect.height / 2) / (rect.height * 0.62));
      hasPointer = true;
    };
    const onLeave = () => {
      hasPointer = false;
    };

    const tick = () => {
      const t = performance.now() / 1000;
      // With no cursor (touch, or pointer off-window) the heads keep scanning.
      const tx = hasPointer ? target.x : Math.sin(t * 0.42) * 0.34;
      const ty = hasPointer ? target.y : Math.sin(t * 0.29 + 1.1) * 0.22;

      HEADS.forEach((spec, i) => {
        const c = cur[i];
        c.x += (tx - c.x) * spec.ease;
        c.y += (ty - c.y) * spec.ease;

        const head = headEls.current[i];
        if (head) {
          const rot = spec.baseRot + c.x * 8 * spec.yaw - c.y * 2;
          head.setAttribute(
            'transform',
            `translate(${spec.x} ${spec.y}) scale(${spec.scale}) rotate(${rot.toFixed(3)} 0 ${PIVOT_Y}) ` +
              `translate(${(c.x * 17 * spec.yaw).toFixed(2)} ${(c.y * 11).toFixed(2)})`,
          );
        }

        const face = faceEls.current[i];
        if (face) {
          // Horizontal squash fakes the foreshortening of a real head turn.
          face.setAttribute(
            'transform',
            `translate(${(c.x * 8 * spec.yaw).toFixed(2)} ${(c.y * 6).toFixed(2)}) ` +
              `scale(${(1 - Math.abs(c.x) * 0.07).toFixed(4)} 1)`,
          );
        }

        const offset = `translate(${(c.x * 7).toFixed(2)} ${(c.y * 5).toFixed(2)})`;
        pupilEls.current[i * 2]?.setAttribute('transform', offset);
        pupilEls.current[i * 2 + 1]?.setAttribute('transform', offset);
      });

      frame = requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('blur', onLeave);
    document.addEventListener('mouseleave', onLeave);
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  const renderHead = (spec: HeadSpec, i: number) => (
    <CerberusHead
      key={spec.uid}
      spec={spec}
      setHead={(el) => {
        headEls.current[i] = el;
      }}
      setFace={(el) => {
        faceEls.current[i] = el;
      }}
      setPupil={(side, el) => {
        pupilEls.current[i * 2 + side] = el;
      }}
    />
  );

  return (
    <svg
      ref={svgRef}
      className="cerberus-beast"
      viewBox="0 0 1000 860"
      role="img"
      aria-label="Cerberus, the three-headed guardian, watching the gate"
      preserveAspectRatio="xMidYMax meet"
    >
      <defs>
        <linearGradient id="cbSkull" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stopColor="#241a35" />
          <stop offset="55%" stopColor="#17101f" />
          <stop offset="100%" stopColor="#0B0314" />
        </linearGradient>
        <linearGradient id="cbPlate" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#34254a" />
          <stop offset="100%" stopColor="#120a1c" />
        </linearGradient>
        <linearGradient id="cbMuzzle" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stopColor="#2a1e40" />
          <stop offset="100%" stopColor="#100a19" />
        </linearGradient>
        <linearGradient id="cbNeck" x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor="#1c1430" />
          <stop offset="100%" stopColor="#0B0314" />
        </linearGradient>
        {/* Kept close to the backdrop value. A lighter torso reads as a hard
            arc across the composition no matter how it is masked. */}
        <linearGradient id="cbChest" x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor="#120a1e" />
          <stop offset="70%" stopColor="#0a0413" />
          <stop offset="100%" stopColor="#08020f" />
        </linearGradient>
        {/* Red is reserved for the eyes. See CLAUDE.md. */}
        <radialGradient id="cbEye">
          <stop offset="0%" stopColor="#fff2f2" />
          <stop offset="32%" stopColor="#ff3b4e" />
          <stop offset="100%" stopColor="#7d0d1a" />
        </radialGradient>
        <linearGradient id="cbTooth" x1="0.3" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="#d5dae2" />
          <stop offset="100%" stopColor="#7d8694" />
        </linearGradient>
        <radialGradient id="cbMouth">
          <stop offset="0%" stopColor="#4a0e3a" />
          <stop offset="100%" stopColor="#110410" />
        </radialGradient>
        <radialGradient id="cbCore">
          <stop offset="0%" stopColor="#c9a4ff" stopOpacity="0.9" />
          <stop offset="60%" stopColor="#7a3fbf" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#7a3fbf" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="cbHalo">
          <stop offset="0%" stopColor="#6d34b0" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#6d34b0" stopOpacity="0" />
        </radialGradient>
        <filter id="cbGlow" x="-140%" y="-140%" width="380%" height="380%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        {/* The torso dissolves into the dark rather than ending in a hard dome,
            which is what made it read as a boulder under the heads. Two nested
            masks multiply, so it fades downward and off both flanks, and leaves
            no silhouette arc anywhere against the background. */}
        <linearGradient id="cbFadeV" gradientUnits="userSpaceOnUse" x1="0" y1="545" x2="0" y2="790">
          <stop offset="0%" stopColor="#fff" stopOpacity="1" />
          <stop offset="35%" stopColor="#fff" stopOpacity="0.68" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="cbFadeH" gradientUnits="userSpaceOnUse" x1="40" y1="0" x2="960" y2="0">
          <stop offset="0%" stopColor="#fff" stopOpacity="0" />
          <stop offset="30%" stopColor="#fff" stopOpacity="1" />
          <stop offset="70%" stopColor="#fff" stopOpacity="1" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="cbBodyMaskV">
          <rect x="0" y="0" width="1000" height="860" fill="url(#cbFadeV)" />
        </mask>
        <mask id="cbBodyMaskH">
          <rect x="0" y="0" width="1000" height="860" fill="url(#cbFadeH)" />
        </mask>
      </defs>

      {/* Ambient depth behind the animal. */}
      <ellipse cx={500} cy={340} rx={360} ry={250} fill="url(#cbHalo)" />

      <g className="cb-breathe">
        {renderHead(HEADS[0], 0)}
        {renderHead(HEADS[1], 1)}

        {/* Chest sits between the flanking heads and the center head so the
            outer necks read as tucked behind the shoulders. Shoulder plates, a
            harness band, and a sternum seam break up what would otherwise be a
            featureless dome. */}
        <g mask="url(#cbBodyMaskV)">
          <g mask="url(#cbBodyMaskH)">
            <path
              d="M 40,860 C 58,732 138,634 268,590 C 348,562 424,544 500,542
                 C 576,544 652,562 732,590 C 862,634 942,732 960,860 Z"
              fill="url(#cbChest)"
            />
            <path d="M 140,860 C 154,748 210,668 300,624 C 326,706 326,788 314,860 Z" fill="url(#cbPlate)" opacity={0.3} />
            <path d="M 860,860 C 846,748 790,668 700,624 C 674,706 674,788 686,860 Z" fill="url(#cbPlate)" opacity={0.3} />
            <path d="M 404,860 C 392,780 398,686 426,616 L 574,616 C 602,686 608,780 596,860 Z" fill="url(#cbPlate)" opacity={0.36} />
            {/* Harness band. It reads as gear and breaks up the torso mass. */}
            <path
              d="M 310,652 C 394,606 606,606 690,652 L 680,700 C 604,662 396,662 320,700 Z"
              fill="url(#cbPlate)"
              opacity={0.7}
            />
            <path d="M 310,652 C 394,606 606,606 690,652" fill="none" stroke="#9d6bff" strokeWidth={1.3} opacity={0.3} />
            <path d="M 300,624 C 326,706 326,788 314,860" fill="none" stroke="#9d6bff" strokeWidth={1.5} opacity={0.24} />
            <path d="M 700,624 C 674,706 674,788 686,860" fill="none" stroke="#c9a4ff" strokeWidth={1.6} opacity={0.26} />
            <path d="M 426,616 C 398,686 392,780 404,860" fill="none" stroke="#9d6bff" strokeWidth={1.1} opacity={0.16} />
            <path d="M 574,616 C 602,686 608,780 596,860" fill="none" stroke="#9d6bff" strokeWidth={1.1} opacity={0.16} />
            <circle className="cb-core" cx={500} cy={648} r={44} fill="url(#cbCore)" />
            <circle cx={500} cy={648} r={9} fill="#d9b8ff" opacity={0.9} filter="url(#cbGlow)" />
          </g>
        </g>

        {renderHead(HEADS[2], 2)}
      </g>

      {/* Embers drift independently of the animal so their transforms never collide. */}
      <g className="cb-embers" aria-hidden="true">
        {[
          { x: 214, r: 2.6, d: '0s', dur: '9s' },
          { x: 336, r: 1.8, d: '2.4s', dur: '11s' },
          { x: 470, r: 2.2, d: '5.1s', dur: '10s' },
          { x: 612, r: 1.6, d: '1.2s', dur: '12s' },
          { x: 742, r: 2.8, d: '3.6s', dur: '9.5s' },
          { x: 836, r: 1.9, d: '6.4s', dur: '13s' },
        ].map((e) => (
          <circle
            key={e.x}
            className="cb-ember"
            cx={e.x}
            cy={860}
            r={e.r}
            fill="#a97bff"
            style={{ animationDelay: e.d, animationDuration: e.dur }}
          />
        ))}
      </g>
    </svg>
  );
}
