const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),parser=require('@babel/parser');
const original=path.resolve(process.env.TAXI_BASELINE_DIR||'../taxi/taxi');const current=path.resolve('.');
if(!fs.existsSync(path.join(original,'src/API'))){console.error('Set TAXI_BASELINE_DIR to the clean baseline taxi app directory before checking the backend boundary.');process.exit(2)}
let files=0;const failures=[];const intentionalFrontendChanges=[];const intentionalHandlerChanges=[];
const allowedCore=new Map([
 ['src/tools/driverCapacity.ts','Release seats and reject taking terminal bookings; exact remaining source checked'],
 ['src/platform/platform-interface/surfaces/passenger/PassengerPresentation.ts','Terminal booking status precedes stale choice candidates; exact remaining source checked'],
 ['src/state/orders/constants.ts','Frontend-only bounded recent terminal history; no API schema change'],
 ['src/state/orders/reducer.ts','Retain server-confirmed driver terminal orders until archive catches up; clear on logout'],
 ['src/tools/liveOrderProfit.ts','Use the actually driven car for the same local estimate on list, map and details'],
 ['src/API/polygon.ts','Bound and validate zone lookup reads; keep the original endpoint, fields and coordinate key'],
 ['src/state/clientOrder/constants.ts','Add frontend-only per-address zone check states'],
 ['src/state/clientOrder/reducer.ts','Track per-address zone verification and invalidate it when the address changes'],
 ['src/state/clientOrder/sagas.ts','Report zone lookup failures; retain takeLatest and existing polygon lookup request'],
 ['src/state/clientOrder/selectors.ts','Expose zone verification state for submission gating'],
 ['src/platform/adapters/LegacyPassengerChannelStoreAdapter.ts','Expose zone status and read the latest confirmation before submitting; no new command'],
 ['src/tools/swipe.ts','Guard a hidden or detached UI panel during ResizeObserver updates; exact original comparison after removing the guard'],
 ['src/API/index.ts','Geocoder read requests include localized name metadata for presentation; other functions checked unchanged'],
 ['src/appCache.ts','Preserve active trip choice and boarding continuity across reload; derived emulator caches still removed'],
 ['src/API/user.ts','Bound session verification read; distinguish authentication refusal from temporary service failure'],
 ['src/API/order.ts','15s timeouts for order reads only; mutation AST bodies checked unchanged'],
 ['src/state/index.ts','Observe read status for stale/offline UI without changing API actions'],
 ['src/state/config/reducer.ts','Restore a saved UI language after remote configuration loads; the original reducer is checked after removing this addition'],
 ['src/tools/utils.ts','Read authoritative order quotes for all UI surfaces; original tariff fallback preserved'],
 ['src/platform/adapters/LegacyChatGateway.ts','Expose optional connection state; original URL and message payloads protected by tests'],
 ['src/platform/platform-interface/realtime/ReconnectingWebSocketClient.ts','Bound socket opening time and report disconnects without replaying commands'],
 ['src/platform/platform-interface/__tests__/ReconnectingWebSocketClient.test.js','Regression for bounded connect timeout and cleanup'],
 ['src/platform/adapters/__tests__/DriverBoardingCommandPath.test.js','Protect boarding gateway on all three UI surfaces; forbid direct start'],
 ['src/state/orders/selectors.ts','Normal-mode visibility and car-class filtering'],
 ['src/state/orders/sagas.ts','Remove forced-empty emulator gate; keep backend requests unchanged'],
 ['src/state/orders/__tests__/readyOrdersPolling.test.js','Exercise polling without emulator flags'],
 ['src/tools/driverBoarding.test.ts','Regression for 111 versus 000'],
 ['src/tools/legacyLogReasons.ts','Remove obsolete emulator_not_running reason'],
 ['src/tools/phoneUtils.ts','Correct display formatting without changing API phone normalization'],
 ['src/localization/index.ts','Service DB translations precede offline fallback; no configuration writes'],
 ['src/state/clientOrder/orderFormResolvers.ts','Frontend availability: hide immediate Voting for intercity/delayed routes; class algorithm unchanged'],
 ['src/state/clientOrder/__tests__/orderFormResolvers.test.js','Regression coverage for service mode availability'],
 ['src/types/types.ts','Optional isCurrent coordinate-request marker; every other byte checked'],
 ['src/App.tsx','UI language/RTL, cross-tab logout and connection banner; original App preserved after removing explicit additions'],
 ['src/API/way.ts','Load the same local road data through worker/cache; remote backend commands unchanged'],
 ['src/state/areas/selectors.ts','Attach prepared graph views and preserve multi-area routing'],
 ['src/tools/order.ts','Bounded arithmetic replaces eval; profit and distance handlers checked separately'],
 ['src/tools/api.ts','Serialize valid 0 and false values; API endpoints and command schema unchanged'],
 ['src/state/user/sagas.ts','Tab-session credential vault and cross-tab logout generation; API commands unchanged'],
]);
const allowedHandlers=new Set(['src/pages/Passenger/index.tsx :: onSubmit','src/pages/Passenger/VotingForm.tsx :: submit','src/pages/Passenger/VotingForm.tsx :: handleLockedCustomerPriceCommit','src/Routes.tsx :: AppRoutesWrapper','src/Routes.tsx :: AppRoutes']);
function compare(dir){for(const entry of fs.readdirSync(path.join(original,dir),{withFileTypes:true})){
 const relative=path.join(dir,entry.name);if(entry.isDirectory())compare(relative);else{files++;if(!fs.existsSync(path.join(current,relative))||!fs.readFileSync(path.join(original,relative)).equals(fs.readFileSync(path.join(current,relative)))){if(allowedCore.has(relative))intentionalFrontendChanges.push({file:relative,reason:allowedCore.get(relative)});else failures.push(relative);}}
}}
for(const dir of ['src/API','src/state','src/platform','src/tools','src/types','src/localization'])compare(dir);

const pointTypes='src/types/types.ts';
if(fs.readFileSync(path.join(current,pointTypes),'utf8').replace('  isCurrent?: boolean\n','')!==fs.readFileSync(path.join(original,pointTypes),'utf8'))failures.push(pointTypes+' :: unexpected schema change');

// Narrow UI-state exceptions: reconstruct the original and compare every other byte.
const capacityFile='src/tools/driverCapacity.ts';
const capacityOriginal=fs.readFileSync(path.join(current,capacityFile),'utf8')
 .replace("import { terminalBooking } from '../design/reliability/rideData'\n",'')
 .replace('return !terminalBooking(order) && !!order?.drivers?.some(driver =>','return !!order?.drivers?.some(driver =>')
 .replace('  if (terminalBooking(order)) return false\n','');
if(capacityOriginal!==fs.readFileSync(path.join(original,capacityFile),'utf8'))failures.push(capacityFile+' :: unexpected non-terminal change');
const passengerFile='src/platform/platform-interface/surfaces/passenger/PassengerPresentation.ts';
const passengerOriginal=fs.readFileSync(path.join(current,passengerFile),'utf8')
 .replace("  // Terminal booking status wins over stale candidates and driver snapshots.\n  if (selectedOrder?.b_canceled || selectedOrder?.b_state === EBookingStates.Canceled) return 'CANCELLED'\n  if (selectedOrder?.b_completed || selectedOrder?.b_state === EBookingStates.Completed) return 'TRIP_FINISHED'\n\n",'')
 .replace('  const driver = facts.selectedDriver ?? getSelectedSimpleDriver(selectedOrder)',"  if (selectedOrder.b_state === EBookingStates.Canceled)\n    return 'CANCELLED'\n\n  const driver = facts.selectedDriver ?? getSelectedSimpleDriver(selectedOrder)")
 .replace('    driver?.c_state === EBookingDriverState.Finished\n','    driver?.c_state === EBookingDriverState.Finished ||\n    selectedOrder.b_state === EBookingStates.Completed\n');
if(passengerOriginal!==fs.readFileSync(path.join(original,passengerFile),'utf8'))failures.push(passengerFile+' :: unexpected non-terminal change');

const swipeFile='src/tools/swipe.ts';
const swipeGuard="    const parent = element.current.offsetParent as HTMLElement | null\n    // The location picker hides this panel; a queued ResizeObserver can also\n    // run while React replaces it during a language change.\n    if (!parent)\n      return [0, 0]\n";
const swipeOriginal=fs.readFileSync(path.join(original,swipeFile),'utf8');
const swipeEdited=fs.readFileSync(path.join(current,swipeFile),'utf8').replace(swipeGuard,"    const parent = element.current.offsetParent! as HTMLElement\n");
if(swipeEdited.trimEnd()!==swipeOriginal.trimEnd())failures.push(swipeFile+' :: unexpected non-visibility change');
// The locale restoration is the only permitted change to config state handling.
const localeReducer='src/state/config/reducer.ts';
const withoutLocaleRestore=fs.readFileSync(path.join(current,localeReducer),'utf8')
 .replace("import { getCookie } from '../../utils/cookies'\n",'')
 .replace("      // Remote configuration can add languages after INIT_USER has already run.\n      // Restore the guest's selection from the now complete language list.\n      const savedLanguage = SITE_CONSTANTS.LANGUAGES.find(i => i.iso === getCookie('user_lang'))\n",'')
 .replace("        .set('language', savedLanguage || state.get('language'))\n",'');
if(withoutLocaleRestore.trimEnd()!==fs.readFileSync(path.join(original,localeReducer),'utf8').trimEnd())failures.push(localeReducer+' :: unexpected non-locale change');
files++;if(!fs.readFileSync(path.join(original,'src/appCache.ts')).equals(fs.readFileSync(path.join(current,'src/appCache.ts'))))intentionalFrontendChanges.push({file:'src/appCache.ts',reason:allowedCore.get('src/appCache.ts')});
for(const relative of ['src/siteConstants.ts','src/config.ts','src/App.tsx']){files++;const source=fs.readFileSync(path.join(original,relative),'utf8'),edited=fs.readFileSync(path.join(current,relative),'utf8');if(source!==edited){if(relative==='src/App.tsx'){
const withoutUi=edited.replace("import ConnectionBar from './design/reliability/ConnectionBar'\n",'').replace("        <ConnectionBar/>\n",'').replace("import { applyUiDocumentLanguage } from './design/ui-language'\nimport './design/rtl.css'\n",'').replace("import { subscribeSessionRevocation } from './security/sessionTokens'\nimport { ActionTypes as UserActionTypes } from './state/user/constants'\nimport { clearOrders } from './state/orders/actionCreators'\n",'').replace("  useEffect(() => { applyUiDocumentLanguage(language?.iso, document.documentElement) }, [language?.iso])\n",'').replace("  useEffect(() => subscribeSessionRevocation(() => {\n    store.dispatch({ type: UserActionTypes.LOGOUT_START })\n    store.dispatch(clearOrders())\n    store.dispatch({ type: UserActionTypes.LOGOUT_SUCCESS })\n  }), [])\n\n",'');
if(withoutUi===source)intentionalFrontendChanges.push({file:relative,reason:allowedCore.get(relative)});else failures.push(relative);
}else failures.push(relative);}}

const targets={
 'src/API/index.ts':['_uploadFile','_checkRefCode','_checkConfig','_postTrip','_getTrips','_getWashTrips','_getImageBlob','_getImageFile','_setOutDrive','makeRoutePoints','notifyPosition','getPointSuggestions','reverseGeocode'],
 'src/API/order.ts':['_postDrive','_cancelDrive','_editOrder','_updateOrderCustomerPrice','_takeOrder','_sendOrderOffer','_participateVotingOrder','_cancelVotingParticipation','_chooseCandidate','_releaseCandidateChoice','_setOrderState','_setOrderRating','_setWaitingTime'],
 'src/API/way.ts':['getAreasIdsBetweenPoints','getAreaFromXML'],
 'src/tools/order.ts':['getOrderDriveStartedAt','updateCompletedOrderDuration','candidateMode','estimateOrder','getProfitFactorsForCar','getOrderDisplayedPrice','estimateProfitByDisplayedPrice','estimateProfit','estimateProfitByDistance','rankProfit','getEstimatedProfit','computeProfitPercentiles','getProfitSortValue','sortOrdersByProfit','calculateDistance','geoDistanceMeters'],
 'src/tools/phoneUtils.ts':['normalizePhoneNumber','getPhoneMask','getPhonePrefix'],
 'src/Routes.tsx':['AppRoutesWrapper','HomePageRedirect','AppRoutes'],
 'src/pages/Passenger/VotingForm.tsx':['submit','handleChooseCandidate','handleConfirmCancelSelectedDriver','handleLockedCustomerPriceCommit','handleLockedCancelClick','handleLockedFinishClick','handleNewOrderClick','handleSavePhoneClick'],
 'src/components/PriceInput/index.tsx':['useMoneySegment','formatMoneyValue','normalizeCustomerPriceInput','normalizeMoneyNumber','makeEditablePriceItem'],
 'src/components/Button/index.tsx':['handleButtonClick'],
 'src/components/BoundaryButtons/index.tsx':['handleLocationClassClick'],
 'src/pages/Passenger/index.tsx':['onSubmit','handleOrderClick','handleNewOrderClick','handleLockedCancel'],
};
function declarations(root){const result={};function walk(node){if(!node||typeof node!=='object')return;if(node.type==='FunctionDeclaration'&&node.id?.name)result[node.id.name]=node;if(node.type==='VariableDeclarator'&&node.id?.type==='Identifier')result[node.id.name]=node.init;for(const val of Object.values(node)){if(Array.isArray(val))val.forEach(walk);else if(val&&typeof val==='object')walk(val)}}walk(root);return result;}
function normalized(node){return JSON.stringify(node,(key,value)=>['start','end','loc','extra','leadingComments','trailingComments','innerComments','comments','tokens'].includes(key)?undefined:value);}
let handlers=0;for(const [file,names] of Object.entries(targets)){
 const read=root=>declarations(parser.parse(fs.readFileSync(path.join(root,file),'utf8'),{sourceType:'module',plugins:['typescript','jsx']}));const a=read(original),b=read(current);
 for(const name of names){handlers++;if(!a[name]||!b[name]||normalized(a[name])!==normalized(b[name])){const key=`${file} :: ${name}`;if(allowedHandlers.has(key))intentionalHandlerChanges.push(key);else failures.push(key)}}
}
const result={unchangedCoreFiles:files-intentionalFrontendChanges.length,unchangedBusinessHandlers:handlers-intentionalHandlerChanges.length,intentionalFrontendChanges,intentionalHandlerChanges,intentionalPresentationFiles:['src/Routes.tsx::UnavailableBase'],failures,ok:failures.length===0};fs.mkdirSync('design-review/shadcn',{recursive:true});fs.writeFileSync('design-review/shadcn/backend-boundary.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));process.exit(result.ok?0:1);
