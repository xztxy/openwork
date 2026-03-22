export { WhatsAppService } from './WhatsAppService';
export type {
  WhatsAppServiceEvents,
  InboundChannelMessage,
  OutboundProgressEvent,
} from './WhatsAppService';
export { TaskBridge } from './taskBridge';
export type { InboundMessage, MessageTransport } from './taskBridge';
export { wireTaskBridge, wireStatusListeners } from './wireTaskBridge';
export {
  getOrCreateWhatsAppService,
  getWhatsAppService,
  clearWhatsAppService,
  disposeWhatsAppService,
  setActiveWhatsAppBridge,
  getActiveWhatsAppBridge,
} from './singleton';
