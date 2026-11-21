import globals from "globals";
import base from "../../eslint.config.mjs";

export default [...base, { ignores: ["dist/**"] }, { languageOptions: { globals: { ...globals.browser, chrome: "readonly" } } }];
