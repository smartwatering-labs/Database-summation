// Retire saved palette links without disturbing the route or other URL state.
document.documentElement.dataset.theme='minimal';
const url=new URL(location.href);
if(url.searchParams.has('theme')){
 url.searchParams.delete('theme');
 history.replaceState(history.state,'',url);
}
