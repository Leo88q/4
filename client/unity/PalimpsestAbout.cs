// Palimpsest — in-game attribution screen (Apache License 2.0 obligation).
// NEW FILE — added by The Palimpsest Authors, not part of upstream Restory.
using UnityEngine;

namespace Palimpsest.Client
{
    /// <summary>
    /// Attach to the Settings / Credits screen. Renders the attribution text
    /// required by the Apache License 2.0 for the Restory base project.
    /// </summary>
    public sealed class PalimpsestAbout : MonoBehaviour
    {
        [TextArea(6, 14)]
        public string attribution =
            "«Палимпсест» основан на открытом проекте Restory (github.com/google/restory),\n" +
            "Copyright Google LLC и авторы PT Zhang, Stefan Linssen, Thibaut Pilipenko,\n" +
            "Tom Granger, лицензированном по Apache License, Version 2.0.\n\n" +
            "Это не официально поддерживаемый продукт Google.\n" +
            "This is not an officially supported Google product.";

        public void CopyToClipboard() => GUIUtility.systemCopyBuffer = attribution;
    }
}
