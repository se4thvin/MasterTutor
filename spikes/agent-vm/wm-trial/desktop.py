"""P0-only fixed desktop tasks over vsock. No shell, file, env, or arbitrary-exec RPC."""
import base64
import json
import os
from pathlib import Path
import shlex
import socket
import subprocess
import time
import xml.etree.ElementTree as ET

CONFIG = Path(__file__).with_name('tasks.json')
TEXT = {'~/Documents/sample.pdf','/home/neko/Documents/sample.pdf','~/Documents/slides.pptx','/home/neko/Documents/slides.pptx','sample.pdf','slides.pptx','/home/neko/Documents','~/Documents','thunar','mousepad','xfce4-terminal','libreoffice --writer','libreoffice --impress','File Manager','Text Editor','Terminal','LibreOffice Writer','LibreOffice Impress'}
KEYS = {'ENTER':'Return','RETURN':'Return','ESC':'Escape','ESCAPE':'Escape','TAB':'Tab','SPACE':'space','BACKSPACE':'BackSpace','DELETE':'Delete','UP':'Up','DOWN':'Down','LEFT':'Left','RIGHT':'Right','HOME':'Home','END':'End','PGUP':'Prior','PGDN':'Next','PAGEUP':'Prior','PAGEDOWN':'Next','CTRL':'ctrl','CONTROL':'ctrl','ALT':'alt','SHIFT':'shift','SUPER':'super','META':'super','WIN':'super'}

def validate_action(action, terminal, task):
    if not isinstance(action, dict): raise ValueError('invalid action')
    if task not in {t['id'] for t in json.loads(CONFIG.read_text())['tasks']}: raise ValueError('unknown task')
    kind = action.get('type')
    if kind not in {'click','double_click','drag','move','scroll','keypress','type','wait','screenshot'}: raise ValueError('unknown action')
    if terminal and kind not in {'wait','screenshot'}: raise ValueError('terminal input denied')
    if kind in {'click','double_click','move','scroll'}:
        for key, limit in [('x',1280),('y',800)]:
            if type(action.get(key)) is not int or not 0 <= action[key] < limit: raise ValueError('coordinate outside display')
    if kind == 'click' and action.get('button','left') not in {'left','right','wheel','back','forward'}: raise ValueError('invalid button')
    if kind == 'type' and (task == 'writer' or action.get('text') not in TEXT): raise ValueError('text outside fixture allowlist')
    if kind == 'keypress':
        keys = action.get('keys', [])
        if not isinstance(keys, list) or not 1 <= len(keys) <= 8 or any(not isinstance(k,str) for k in keys): raise ValueError('invalid chord')
        keys = [k.upper() for k in keys]
        modified = any(k in {'CTRL','CONTROL','ALT','SUPER','META','WIN'} for k in keys)
        if any(k not in KEYS and k not in {'F1','F2','F4','F10','F11','F12'} and not (modified and k in {'A','D','E','F','L','N','O','Q','S','T','W'}) for k in keys): raise ValueError('key denied')
        if 'ALT' in keys and any(k in keys for k in ['CTRL','CONTROL']) and any(k in keys for k in ['DELETE','BACKSPACE','F1','F2','F4']): raise ValueError('system shortcut denied')
        if task == 'writer' and 'F2' in keys: raise ValueError('writer must use menu')
    if kind == 'drag':
        path = action.get('path')
        if not isinstance(path,list) or not 2 <= len(path) <= 100: raise ValueError('invalid drag')
        for point in path: validate_action({'type':'move',**point},False,task)
    if kind == 'scroll' and any(type(action.get(k)) is not int or abs(action[k])>3000 for k in ['scroll_x','scroll_y']): raise ValueError('scroll too large')
    return action


def run(args, output=False):
    result = subprocess.run(args, env={**os.environ,'DISPLAY':':99.0','HOME':'/home/neko','USER':'neko'}, stdout=subprocess.PIPE if output else subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
    return result.stdout.decode('utf8','replace') if output else None


def windows():
    found = []
    for line in run(['wmctrl','-lx'], True).splitlines():
        parts = line.split(None,4)
        if len(parts) == 5: found.append({'id':parts[0],'class':parts[2].lower(),'title':parts[4]})
    return found


def active_class():
    try:
        identity = run(['xdotool','getactivewindow'],True).strip()
        value = hex(int(identity))
        return next((w['class'] for w in windows() if int(w['id'],16)==int(value,16)), '')
    except (ValueError,subprocess.TimeoutExpired): return ''


def launch(args):
    subprocess.Popen(['/bin/su','neko','-s','/bin/sh','-c',shlex.join(args)], env={**os.environ,'DISPLAY':':99.0','HOME':'/home/neko','USER':'neko','XDG_RUNTIME_DIR':'/run/user/1000'}, stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)


def wm_switch(wm):
    if wm not in {'openbox','xfce'}: raise ValueError('unknown WM')
    for name in ['openbox','tint2','xfce4-session','xfce4-panel','xfwm4','xfdesktop','xfsettingsd']:
        run(['pkill','-u','1000','-x',name])
    time.sleep(.5)
    if wm == 'xfce': launch(['dbus-run-session','--','xfce4-session'])
    else:
        home = Path('/opt/spike')
        root = ET.Element('openbox_menu',xmlns='http://openbox.org/3.4/menu')
        menu = ET.SubElement(root,'menu',id='root-menu',label='Applications')
        for app in json.loads(CONFIG.read_text())['apps'].values():
            item = ET.SubElement(menu,'item',label=app['label']); action = ET.SubElement(item,'action',name='Execute')
            ET.SubElement(action,'command').text = ' '.join(app['command'])
        ET.ElementTree(root).write(home/'menu.xml',encoding='utf8',xml_declaration=True)
        config = Path('/etc/xdg/openbox/rc.xml').read_text().replace('<file>menu.xml</file>', '<file>/opt/spike/menu.xml</file>')
        (home/'openbox-rc.xml').write_text(config)
        launch(['openbox','--config-file',str(home/'openbox-rc.xml')]); launch(['tint2'])
    time.sleep(5)
    return {'wm':wm}


def baseline(task):
    if task not in {t['id'] for t in json.loads(CONFIG.read_text())['tasks']}: raise ValueError('unknown task')
    for name in ['Thunar','xfce4-terminal','soffice.bin','evince','mousepad','zenity']:
        run(['pkill','-u','1000','-x',name])
    time.sleep(.5)
    for w in windows():
        if 'chromium' in w['class']: run(['xdotool','windowminimize',w['id']])
    if task in {'maximize'}: launch(['evince','/home/neko/Documents/sample.pdf'])
    if task == 'dialog': launch(['zenity','--info','--text=P0 fixture dialog','--title=P0 fixture dialog'])
    if task == 'chromium': launch(['thunar','/home/neko/Documents'])
    time.sleep(2)
    if task == 'maximize':
        for w in windows():
            if 'evince' in w['class']:
                run(['wmctrl','-ir',w['id'],'-b','remove,maximized_vert,maximized_horz'])
                run(['wmctrl','-ir',w['id'],'-e','0,100,100,600,400'])
    return {'ready':True}


def check(task):
    values = windows()
    target = {'pdf':'evince','terminal':'xfce4-terminal','writer':'libreoffice-writer','impress':'libreoffice-impress','editor':'mousepad'}.get(task)
    if target:
        return any(target in w['class'] and (task not in {'pdf','impress'} or ('sample' if task=='pdf' else 'slides') in w['title'].lower()) for w in values)
    if task == 'chromium': return 'chromium' in active_class()
    if task == 'dialog': return not any('zenity' in w['class'] for w in values)
    if task == 'maximize':
        for w in values:
            if 'evince' in w['class']:
                state = run(['xprop','-id',w['id'],'_NET_WM_STATE'],True)
                return all(s in state for s in ['_NET_WM_STATE_MAXIMIZED_VERT','_NET_WM_STATE_MAXIMIZED_HORZ'])
    return False


def actuate(action, task):
    action = validate_action(action, 'xfce4-terminal' in active_class(), task)
    kind = action['type']
    if kind in {'click','double_click','move','scroll'}: run(['xdotool','mousemove',str(action['x']),str(action['y'])])
    if kind in {'click','double_click'}:
        button = {'left':'1','wheel':'2','right':'3','back':'8','forward':'9'}.get(action.get('button','left'),'1')
        run(['xdotool','click','--repeat','2' if kind=='double_click' else '1','--delay','100',button])
    if kind == 'type': run(['xdotool','type','--clearmodifiers','--',action['text']])
    if kind == 'keypress': run(['xdotool','key','--clearmodifiers','+'.join(KEYS.get(k.upper(),k.lower() if len(k)==1 else k.upper()) for k in action['keys'])])
    if kind == 'scroll':
        for axis,positive,negative in [('scroll_y','5','4'),('scroll_x','7','6')]:
            delta=action[axis]
            if delta: run(['xdotool','click','--repeat',str(min(30,max(1,abs(delta)//100))),'--delay','20',positive if delta>0 else negative])
    if kind == 'drag':
        run(['xdotool','mousemove',str(action['path'][0]['x']),str(action['path'][0]['y']),'mousedown','1'])
        try:
            for point in action['path'][1:]: run(['xdotool','mousemove',str(point['x']),str(point['y'])])
        finally: run(['xdotool','mouseup','1'])
    time.sleep(.5 if kind != 'wait' else 1)
    return {'success':check(task)}


def screenshot():
    xwd = subprocess.run(['xwd','-root','-silent','-display',':99.0'], stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=5,check=True).stdout
    png = subprocess.run(['convert','xwd:-','png:-'],input=xwd,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=10,check=True).stdout
    if len(png)>8*1024*1024 or png[:8]!=b'\x89PNG\r\n\x1a\n' or int.from_bytes(png[16:20],'big')!=1280 or int.from_bytes(png[20:24],'big')!=800: raise ValueError('invalid screenshot dimensions')
    return {'png':base64.b64encode(png).decode()}


def main():
    with socket.socket(socket.AF_VSOCK,socket.SOCK_STREAM) as listener:
        listener.bind((socket.VMADDR_CID_ANY,52)); listener.listen(4)
        while True:
            connection,_ = listener.accept()
            with connection, connection.makefile('rb') as stream:
                try:
                    line = stream.readline(65537)
                    if len(line)>65536: raise ValueError('oversized RPC')
                    data = json.loads(line)
                    method = data['method']
                    if method=='screenshot': result=screenshot()
                    elif method=='wm': result=wm_switch(data['wm'])
                    elif method=='baseline': result=baseline(data['task'])
                    elif method=='check': result={'success':check(data['task'])}
                    elif method=='act': result=actuate(data['action'],data['task'])
                    else: raise ValueError('unknown method')
                except Exception as error: result={'error':'desktop_request_failed','exception_class':type(error).__name__}
                connection.sendall(json.dumps(result).encode()+b'\n')

if __name__=='__main__': main()
