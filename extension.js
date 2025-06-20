import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js'; // https://gitlab.gnome.org/GNOME/gnome-shell/-/tree/main/js/ui
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Misc from './src/misc.js';
import * as Timer from './src/Timer.js';
import * as Settings from './src/Settings.js';
import * as Hotkey from './src/Hotkey.js';

export default class TimerExtension extends Extension {
   enable() {
      this.timer = new Timer.Timer();
      this.settings = new Settings.Settings(this.getSettings());
            
      this.panelButton = new PanelMenu.Button(0, "MainButton", false);      
      this.panelButton.add_style_class_name('simple-timer-panel-button');
      
      // MAIN PANEL
      this.icon = new St.Icon({ icon_name: 'alarm-symbolic', style_class: 'system-status-icon' });
      this.timerLabel = new St.Label({ text: '0:00', y_expand: true, y_align: Clutter.ActorAlign.CENTER });
      this.timerLabel.hide();      
      
      this.panelButtonLayout = new St.BoxLayout();
      this.panelButtonLayout.add_child(this.icon);
      this.panelButtonLayout.add_child(this.timerLabel);
            
      
      // Timer Input Field            
      this.menuTimerInputEntry = new St.Entry({
         name: 'time',
         text: '1:00:00',
         primary_icon : new St.Icon({ icon_name : 'media-playback-start-symbolic', icon_size : 24 }),
         can_focus : true,
         hint_text: _("Enter countdown time..."),
         x_expand : true,
         y_expand : true,
         text: this.settings.getLastTimerInput(),
      });

      // Focus Input field when panel is opened
      this.panelButton.menu.connect('open-state-changed', (menu, isOpen) => {
         if (isOpen) {
            this.menuOpeningDelayID = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
               this.menuTimerInputEntry.grab_key_focus();
               this.menuOpeningDelayID = null;
               return GLib.SOURCE_REMOVE;
            });
         }
      });

      this.menuTimerInputEntry.set_input_purpose(Clutter.TIME);
      this.menuTimerInputEntry.clutter_text.set_max_length(12);

      // Input Field Event Management
      this.menuTimerInputEntry.clutter_text.connect('activate', ()=> {
         this.timerStart();
      });
      this.menuTimerInputEntry.connect('primary-icon-clicked', () => { 
         this.timerStart();
      });
      
      // Timer-Input Text Change Event Handling
      this.menuTimerInputEntry.clutter_text.connect('text-changed', ()=> {
         let text = this.menuTimerInputEntry.get_text();                  
         let newText = "";

         // This filters the time input based on its format, either as a colon-separated format like "3:00:00" or a letter format like "2h 47m 12s".
         if (Misc.getTimeInputFormat(text) === Misc.TimeInputFormat.LETTERS) {
            newText = Misc.timeInputLetterHandler(text);
         } else {
            newText = Misc.timeInputColonHandler(text);
         }

         // If the input filter has changed the input, we update the text input field with the corrected text.
         if (text != newText) {
            this.menuTimerInputEntry.set_text(newText);
         }         
      });      
      
      this.itemInput = new PopupMenu.PopupBaseMenuItem({
         reactive : false,
         can_focus : false
      });
      this.itemInput.add_child(this.menuTimerInputEntry);
      this.panelButton.menu.addMenuItem(this.itemInput);
            
      // PANEL-MENU
      let boxMenuItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
      let boxLayout = new St.BoxLayout({ x_align: Clutter.ActorAlign.CENTER, x_expand: true });      
      boxMenuItem.add_child(boxLayout);

      // Resume Button
      this.menuButtonResume = new PopupMenu.PopupImageMenuItem("", "media-playback-start-symbolic", {style_class: 'control-button'});
      this.menuButtonResume.connect('activate', () => {
         if (this.timer.isFinished() || this.timer.isStopped()) {
            this.timerStart();
         } else {
            this.timer.resume();
         }

         this.updateMenuButtonVisibilty();
      });      
      boxLayout.add_child(this.menuButtonResume);
      this.panelButton.menu.addMenuItem(boxMenuItem);

      // Pause Button
      this.menuButtonPause = new PopupMenu.PopupImageMenuItem("", "media-playback-pause-symbolic", {style_class: 'control-button'});
      this.menuButtonPause.connect('activate', () => {
         this.timer.pause();
         this.updateMenuButtonVisibilty();
      });      
      boxLayout.add_child(this.menuButtonPause);

      // STOP Button
      this.menuButtonStop = new PopupMenu.PopupImageMenuItem("", "media-playback-stop-symbolic", {style_class: 'control-button'});
      this.menuButtonStop.connect('activate', () => {
         this.timer.reset();
         this.updateTimerLabelStyle();
         this.updateTimerLabel();
         this.timerLabel.hide();
         this.icon.show();
         this.updateMenuButtonVisibilty();
      });
      boxLayout.add_child(this.menuButtonStop);      
      
      this.panelButton.add_child(this.panelButtonLayout);      
      
      // Create a separator
      this.panelButton.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      
      // Settings entry
      const settingsMenuItem = new PopupMenu.PopupImageMenuItem('', 'preferences-system-symbolic', {style_class: 'control-button'});
      settingsMenuItem.x_align = Clutter.ActorAlign.CENTER;
      settingsMenuItem.connect('activate', () => {
         this.openPreferences();
      });
      this.panelButton.menu.addMenuItem(settingsMenuItem);

      // Adds the panel button to the status area, positioned on the right side of the panel.
      Main.panel.addToStatusArea(this.uuid, this.panelButton, 0, "right");

      // Start
      this.updateMenuButtonVisibilty();
      this.initMainLoop();
      
      // Check if timer is still running, and if it is -> reload the timer running view      
      if (this.timer.isRunning()) {
         this.timer.update();
         this.timerShow();
      } else {
         this.timer.start(3600);
         this.timerShow();
      }

      this.hotkey = new Hotkey.Hotkey(this.settings, this.settings.getAlertStartHotkeyID(), this.timerStart.bind(this));
   }

   disable() {
      this.hotkey.free();
      this.hotkey = null;

      if (this.menuOpeningDelayID) {
         GLib.Source.remove(this.menuOpeningDelayID);
         this.menuOpeningDelayID = null;
      }
      // The Session-Mode "unlock-dialog" is needed because the timer should also be working on the lock screen.
      this.freeMainLoop();
      this.panelButton.destroy();
      this.panelButton = null;
      this.timer = null;
      this.settings = null;
   }
   
   // Shows Start/Input Timer or Stop Button in the Menu, depending on the current timer state [running/stopped].
   updateMenuButtonVisibilty() {      
      //showStartEntry ? this.menuTimerInputEntry.show() : this.menuTimerInputEntry.hide();
      this.handleButtonStyle(this.menuButtonStop, !this.timer.isStopped());
      this.handleButtonStyle(this.menuButtonPause, this.timer.isRunning());
      this.handleButtonStyle(this.menuButtonResume, !this.timer.isRunning());
   }   

   initMainLoop() {
      // Update Timer
      this.timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
         this.timer.update();
         this.updateTimerLabel();
         
         if (this.timer.isFinished() && !this.timer.isNotificationSent()) {
            this.timer.setNotificationSent();
            this.createTimerFinishedAlert();            
            this.updateMenuButtonVisibilty();
         }

         this.updateTimerLabelStyle();
         
         return GLib.SOURCE_CONTINUE;
      });
   }

   freeMainLoop() {
      GLib.Source.remove(this.timeout);
      this.timeout = null;
   }

   // Starts the timer and sets the countdown time.
   timerStart() {      
      let timeSeconds = Misc.parseTimeInput( this.menuTimerInputEntry.get_text() );
      
      if (timeSeconds > 0) {
         this.settings.setLastTimerInput(this.menuTimerInputEntry.get_text());
         this.timer.start(timeSeconds);
         this.timerShow();
      }      
   }

   // Shows the timer if it is running
   timerShow() {
      if (this.timer.isRunning()) {
         this.updateTimerLabel();
         this.updateTimerLabelStyle(false);
         this.timerLabel.show();
         this.icon.hide();
         this.menuButtonStop.show();
         this.updateMenuButtonVisibilty();
      }      
   }

   // Updates the timer-label with the current time left.
   updateTimerLabel() {      
      this.timerLabel.set_text( Misc.formatTime(this.timer.timeLeftSeconds) );
   }

   // Shows the Timer in a different style depending on wether an alert was triggered, or not.
   updateTimerLabelStyle() {
      if (this.timerLabel) {
         let style = '';

         if (this.timer.isFinished()) {
            style = 'countdown-alert';
         } else if (this.timer.isPaused()) {
            style = 'countdown-paused';
         } else {
            style = 'countdown';
         }

         if (this.timerLabel.style_class != style) {
            this.timerLabel.style_class = style;
         }
      }
   }
   
   // Swichtes style classes depending on button active status.
   handleButtonStyle(button, active) {
      button.sensitive = active;

      if (active) {
         button.remove_style_class_name('img-button-inactive');
      } else {
         button.add_style_class_name('img-button-inactive');
      }
   }
   
   // Alert by sending a notification and a sound effect.
   createTimerFinishedAlert() {
      const defaultAudioFile = GLib.build_filenamev([this.path, '/sfx/Polite.wav']);
      const customAudioFile = this.settings.getCustomAlertSfxFile();
      const audioFile = Misc.fileExists(customAudioFile) ? customAudioFile : defaultAudioFile;

      Misc.playAudio(global, audioFile);
      
      // Send Notification
      const systemSource = MessageTray.getSystemSource();
      const notification = new MessageTray.Notification({
         source: systemSource,
         title: 'Timer',
         body: 'The timer has finished!',
         gicon: new Gio.ThemedIcon({name: 'alarm-symbolic'}),
         // Same as `gicon`, but takes a themed icon name
         iconName: 'alarm-symbolic'
      });
      systemSource.addNotification(notification);     
   }      
}
