/**
 * TanStack Query keys shared between components that do not otherwise import
 * each other.
 *
 * The compose dialog's Design picker reads the uploaded-template list, and the
 * settings section that uploads and deletes templates has to invalidate it.
 * Importing the key from the picker component would pull that component —
 * and the popover it renders — into the settings bundle for one constant.
 */
export const CUSTOM_TEMPLATES_QUERY_KEY = ["custom-templates"] as const;
