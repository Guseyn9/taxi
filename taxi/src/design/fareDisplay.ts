/** Display precision only. Never changes the fare sent to the service. */
export function formatEstimatedFare(value:unknown,locale='en'):string {
 const amount=Number(value)
 if(value===null || value===undefined || value==='' || !Number.isFinite(amount) || amount<0)return '—'
 try{return new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(amount)}catch{return new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(amount)}
}
