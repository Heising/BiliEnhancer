let li, parent
let i = setInterval(() => {
    try {
        li = document.getElementsByClassName('bpx-player-ctrl-playbackrate-menu-item')
        parent = li[1].parentNode
    } catch (error) {
        console.log("[BiliEnhancer] 捕获失败0.5秒后重试");
        return
    }


    console.log("[BiliEnhancer] 捕获成功");
    clearInterval(i)
    const dupNode = li[1].cloneNode();

    dupNode.setAttribute('data-value', '1.8')
    dupNode.innerText = '1.8x'
    parent.insertBefore(dupNode, li[1]);


    const dupNode25 = li[1].cloneNode();

    dupNode25.setAttribute('data-value', '2.5')
    dupNode25.innerText = '2.5x'
    parent.insertBefore(dupNode25, li[0]);


    const dupNode30 = li[1].cloneNode();

    dupNode30.setAttribute('data-value', '3.0')
    dupNode30.innerText = '3.0x'
    parent.insertBefore(dupNode30, li[0]);
}, 500)