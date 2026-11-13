import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

globalThis.__UI_SDK_STRICT__ = true
HTMLElement.prototype.showPopover = function () {}
HTMLElement.prototype.hidePopover = function () {}
Element.prototype.getAnimations = () => []
Element.prototype.scrollIntoView = function () {}
Element.prototype.checkVisibility = () => true
Element.prototype.getClientRects = () => []
document.elementFromPoint = () => null
document.elementsFromPoint = () => []
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
document.head.append(Object.assign(document.createElement('style'), { textContent: '[popover] { display: block !important }' }))

afterEach(cleanup)
