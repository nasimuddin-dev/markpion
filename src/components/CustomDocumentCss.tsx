import { useMemo } from "react";
import { scopeCustomCss } from "../services/customCss";
import { documentCss } from "../services/documentStyles";
import { useSettings } from "../stores/settingsStore";

/** The document style and the user's custom CSS, limited to rendered documents (preview, print, slides). */
export function CustomDocumentCss() {
  const customCss = useSettings((s) => s.settings.customCss);
  const documentStyle = useSettings((s) => s.settings.documentStyle);
  const scoped = useMemo(() => scopeCustomCss(documentCss({ documentStyle, customCss })), [documentStyle, customCss]);
  return scoped ? <style data-custom-document-css="">{scoped}</style> : null;
}
