(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),t.credentials=e.crossOrigin===`use-credentials`?`include`:e.crossOrigin===`anonymous`?`omit`:`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var{createEditor:e}=await import(new URL(`croq-mirror.min.js`,document.baseURI).href),t=document.querySelector(`#status`),n=()=>document.querySelector(`input[name="language"]:checked`).value,r=()=>document.querySelector(`input[name="code-language"]:checked`).value,i=document.querySelector(`#extensions`),a=()=>Object.fromEntries(Array.from(i.querySelectorAll(`input[type="checkbox"]`),e=>[e.name,e.checked])),o={javascript:`class Greeter {
	greet(name) {
		const message = "Hello, " + name;
		if (name) {
			console.log(message);
		}
	}
}

new Greeter().greet("Croqujs");`,java:`class Greeter {
	public static void main(String[] args) {
		String message = "Hello, Java";
		int count = 10;
		if (count > 0) {
			showMessage(message);
		}
	}
	static void showMessage(String message) {
		IO.println(message);
	}
}`},s,c=r();try{let l=async(t,r)=>{let i=await e(document.querySelector(`#editor`),{language:n(),codeLanguage:r,value:t,fontSize:18,...a()});return i.setSettings(a()),i};s=await l(o[c],c),document.querySelector(`#language`).onchange=()=>s.setSettings({language:n()}),document.querySelector(`#code-language`).onchange=async()=>{let e=r();if(e!==c){s&&=(o[c]=s.getValue(),s.destroy(),null),c=e;try{s=await l(o[c],c),t.textContent=`Switched to ${c}.`}catch(e){t.textContent=e.stack||e.message}}},i.onchange=()=>s?.setSettings(a()),document.querySelector(`#undo`).onclick=()=>s.execute(`undo`),document.querySelector(`#paste`).onmousedown=e=>e.preventDefault(),document.querySelector(`#paste`).onclick=async()=>{let e=s.getSettings();if(e.disabled||e.readOnly){t.textContent=`Paste is disabled while the editor is read-only or disabled.`;return}let n=s.getValue();try{s.execute(`paste`),await new Promise(e=>setTimeout(e,50)),t.textContent=s.getValue()===n?`No text change detected. Your browser may block the Paste button. Try Ctrl+V or Command+V in the editor. Pasting identical text may also leave it unchanged.`:`Editor text changed after Paste.`}catch(e){t.textContent=`Paste failed: `+e.message}},document.querySelector(`#format`).onclick=()=>s.execute(`format`),document.querySelector(`#analysis`).onclick=async()=>{t.textContent=JSON.stringify(await s.analyzeNow(),null,2)};for(let e of[`readonly`,`disabled`])document.querySelector(`#`+e).onclick=()=>{let n=e===`readonly`?`readOnly`:e;s.setSettings({[n]:!s.getSettings()[n]}),t.textContent=JSON.stringify(s.getState())};document.querySelector(`#recreate`).onclick=async()=>{let e=s.getValue();s.destroy(),s=await l(e,c),t.textContent=`Editor recreated.`},t.textContent=`Ready. Try IME input, search, completion, and resizing.`}catch(e){t.textContent=e.stack}