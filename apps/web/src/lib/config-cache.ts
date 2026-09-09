import "server-only"
import { cache } from "react"
import { brandingRefs, getConfig, getSetupState } from "@sendstack/config"

export const getSetupStateCached = cache(getSetupState)
export const getConfigCached = cache(getConfig)
export const getBrandingRefsCached = cache(brandingRefs)