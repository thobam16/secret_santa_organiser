import type { CSSProperties } from "react";

const lightColours = ["#ffd27b", "#ff6568", "#9cddb4", "#ffd27b", "#8ccde5"];

function PineCorner({ right = false }: { right?: boolean }) {
  return (
    <svg
      className={`festive-pine-corner ${right ? "right" : "left"}`}
      viewBox="0 0 340 180"
      fill="none"
      focusable="false"
    >
      <path d="M-25 4C75 43 167 91 323 103" stroke="#775d34" strokeWidth="7" />
      {Array.from({ length: 14 }, (_, i) => {
        const x = i * 24;
        const y = 17 + i * 6.2;
        return (
          <g key={i} transform={`translate(${x} ${y}) rotate(${18 - i * 1.4})`}>
            <path
              d="M0 0L-30-30M0 0L-8-39M0 0L15-33M0 0L27-23M0 0L-24 24M0 0L-3 34M0 0L18 29"
              stroke="#296a48"
              strokeWidth="5"
              strokeLinecap="round"
            />
            <path
              d="M0 0L-19-27M0 0L4-31M0 0L22-17M0 0L-12 25M0 0L10 26"
              stroke="#3a8358"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>
        );
      })}
      <g fill="#cf3948" stroke="#ed6370" strokeWidth="1">
        <circle cx="102" cy="49" r="9" />
        <circle cx="116" cy="58" r="9" />
        <circle cx="101" cy="66" r="9" />
        <circle cx="251" cy="89" r="7" />
        <circle cx="262" cy="97" r="7" />
        <circle cx="250" cy="103" r="7" />
      </g>
      <path
        d="M157 75C142 45 119 53 131 69C137 77 148 78 157 75ZM157 75C175 46 196 60 181 72C173 79 163 78 157 75Z"
        fill="#b82039"
        stroke="#e84d59"
        strokeWidth="2"
      />
      <path d="M155 75L139 113L152 106L160 119L164 76" fill="#bf273f" />
    </svg>
  );
}

function Ornament({ right = false }: { right?: boolean }) {
  return (
    <svg
      className={`festive-ornament ${right ? "right" : "left"}`}
      viewBox="0 0 74 195"
      fill="none"
      focusable="false"
    >
      <path d="M37 0V104" stroke="#d7b36c" strokeWidth="1.5" />
      <path
        d="M32 111V106C32 100 42 100 42 106V111"
        stroke="#f2cf84"
        strokeWidth="2"
      />
      <rect x="28" y="110" width="18" height="9" rx="2" fill="#e5b86b" />
      <circle
        cx="37"
        cy="148"
        r="31"
        fill={right ? "#c89c43" : "#b5263d"}
        stroke={right ? "#f4d68c" : "#eb6772"}
        strokeWidth="2"
      />
      <path
        d="M9 141C25 151 50 151 65 141M9 155C25 164 50 164 65 155"
        stroke={right ? "#f8e5af" : "#f0b68c"}
        strokeWidth="3"
      />
      <path
        d="M23 126C16 132 14 140 14 147"
        stroke="#fff7d8"
        strokeOpacity=".55"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M37 132L40 139L47 142L40 145L37 152L34 145L27 142L34 139Z"
        fill="#fff0b6"
      />
    </svg>
  );
}

function WinterTrees({ right = false }: { right?: boolean }) {
  return (
    <svg
      className={`festive-trees ${right ? "right" : "left"}`}
      viewBox="0 0 440 470"
      fill="none"
      focusable="false"
    >
      <path
        d="M69 91L28 174H49L5 251H33L-24 343H42V422H94V343H161L106 251H132L88 174H109L69 91Z"
        fill="#214d3a"
      />
      <path
        d="M311 159L275 224H294L250 295H276L225 379H292V444H329V379H395L344 295H366L329 224H347L311 159Z"
        fill="#1a4937"
      />
      <path
        d="M192 33L138 130H167L105 231H139L66 348H165V456H220V348H318L246 231H280L218 130H247L192 33Z"
        fill="#2c6448"
      />
      <path
        d="M192 33L163 85L183 78L194 88L205 79L221 85L192 33ZM138 130L167 132L159 147L177 141L192 151L207 140L224 148L218 132L247 130L233 154H149L138 130ZM105 231L139 234L128 250L155 241L173 252L193 241L213 253L231 242L256 250L246 234L280 231L264 256H121L105 231Z"
        fill="#c8dcca"
        opacity=".7"
      />
      <path
        d="M192 9L199 25L217 27L203 39L207 57L192 48L176 57L180 39L166 27L185 25L192 9Z"
        fill="#e8c473"
      />
      <path
        d="M148 161C168 182 211 188 239 177M117 268C151 294 225 311 280 286"
        stroke="#e6bd65"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <g fill="#c9384a">
        <circle cx="175" cy="119" r="7" />
        <circle cx="223" cy="209" r="8" />
        <circle cx="139" cy="285" r="8" />
        <circle cx="250" cy="321" r="7" />
      </g>
      <g fill="#f4d780">
        <circle cx="204" cy="157" r="6" />
        <circle cx="161" cy="222" r="7" />
        <circle cx="210" cy="281" r="6" />
        <circle cx="173" cy="331" r="7" />
      </g>
      <path
        d="M-20 440C72 410 133 446 215 428C302 410 352 437 459 417V470H-20V440Z"
        fill="#709982"
        opacity=".3"
      />
      <path
        d="M-20 461C67 438 151 458 233 450C316 442 370 455 459 444V470H-20V461Z"
        fill="#d6e4d5"
        opacity=".38"
      />
    </svg>
  );
}

/** Static decoration, separate from the scaled UI and the animated snow layer. */
export default function FestiveDecor() {
  return (
    <div className="festive-decor" aria-hidden="true">
      <svg
        className="festive-stars"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        fill="#f8d99c"
        focusable="false"
      >
        <g opacity=".45">
          <circle cx="122" cy="178" r="1.7" />
          <circle cx="408" cy="138" r="1.3" />
          <circle cx="780" cy="174" r="1.6" />
          <circle cx="1040" cy="131" r="1.4" />
          <circle cx="1452" cy="207" r="1.8" />
          <circle cx="1530" cy="416" r="1.3" />
          <circle cx="39" cy="437" r="1.3" />
          <circle cx="680" cy="370" r="1.5" />
          <circle cx="1181" cy="296" r="1.2" />
          <circle cx="493" cy="530" r="1.2" />
          <circle cx="939" cy="601" r="1.6" />
          <circle cx="1476" cy="683" r="1.4" />
        </g>
        <g opacity=".5">
          <path d="M352 229L354 236L361 238L354 240L352 247L350 240L343 238L350 236Z" />
          <path d="M1364 290L1366 297L1373 299L1366 301L1364 308L1362 301L1355 299L1362 297Z" />
          <path d="M91 618L93 625L100 627L93 629L91 636L89 629L82 627L89 625Z" />
        </g>
      </svg>
      <PineCorner />
      <PineCorner right />
      <div className="festive-lights">
        <svg
          className="festive-light-wire"
          viewBox="0 0 1440 70"
          preserveAspectRatio="none"
          fill="none"
          focusable="false"
        >
          <path
            d="M0 12Q720 74 1440 12"
            stroke="#5b7851"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {Array.from({ length: 28 }, (_, index) => {
          const position = (index + 0.5) / 28;
          return (
            <span
              key={index}
              className="festive-light"
              style={
                {
                  left: `${position * 100}%`,
                  "--bulb-color": lightColours[index % lightColours.length],
                  "--hang": `${12 + 124 * position * (1 - position)}px`,
                } as CSSProperties
              }
            />
          );
        })}
      </div>
      <Ornament />
      <Ornament right />
      <WinterTrees />
      <WinterTrees right />
    </div>
  );
}
