// Arriba del resumen: «Volver» y «Compartir», el nombre de la ruta y su fecha con los km y el tiempo.
import { ShareButton } from "../../components/ShareButton";
import type { ColorBy } from "../../draw/mapa";
import { BackIcon, ShareIcon } from "../../icons";

interface Props {
  title: string;
  sub: string;
  colorBy: ColorBy;
  onBack: () => void;
}

export function SummaryHeader({ title, sub, colorBy, onBack }: Props) {
  return (
    <>
      <div className="toolbar">
        <button className="quiet back" id="ruf-back" onClick={onBack}>
          <BackIcon />
          Volver
        </button>
        <ShareButton id="ruf-share" kind="ruta" colorBy={colorBy}>
          <ShareIcon />
          Compartir
        </ShareButton>
      </div>
      <header className="page-head">
        <h1 className="title" id="ruf-title">
          {title}
        </h1>
        <p className="muted" id="ruf-sub">
          {sub}
        </p>
      </header>
    </>
  );
}
