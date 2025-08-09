const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
  // ID utilisateur (HWID) ou "default" pour les paramètres par défaut
  id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Paramètres Anti-AFK
  AntiAFK: {
    delay_between_buttons: {
      type: Number,
      default: 2
    },
    interval: {
      type: Number,
      default: 60.6
    },
    left_bumper_duration: {
      type: Number,
      default: 1
    },
    right_bumper_duration: {
      type: Number,
      default: 1
    },
    antiafk_interval: {
      type: Number,
      default: 120
    }
  },
  
  // Paramètres de mouvement
  Movement: {
    ads_chance: {
      type: Number,
      default: 0.04
    },
    crouch_chance: {
      type: Number,
      default: 0.3
    },
    forward_bias: {
      type: Number,
      default: 0.4
    },
    forward_intensity: {
      type: Number,
      default: 2
    },
    jump_chance: {
      type: Number,
      default: 1
    },
    jump_interval: {
      type: Number,
      default: 10
    },
    look_intensity: {
      type: Number,
      default: 3
    },
    max_break_duration: {
      type: Number,
      default: 20
    },
    max_movement_duration: {
      type: Number,
      default: 14.817396002160994
    },
    min_break_duration: {
      type: Number,
      default: 10
    },
    min_movement_duration: {
      type: Number,
      default: 10
    },
    move_intensity: {
      type: Number,
      default: 2
    },
    shoot_chance: {
      type: Number,
      default: 0.1
    },
    shoot_duration: {
      type: Number,
      default: 0.298
    },
    strafe_chance: {
      type: Number,
      default: 0.25
    },
    weapon_switch_chance: {
      type: Number,
      default: 1
    },
    weapon_switch_interval: {
      type: Number,
      default: 15
    },
    x_button_chance: {
      type: Number,
      default: 0.3
    },
    x_button_interval: {
      type: Number,
      default: 5
    }
  }
}, {
  timestamps: true,
  collection: 'settings'
});

// Méthodes statiques
settingSchema.statics.getDefaultSettings = function() {
  return this.findOne({ id: 'default' });
};

settingSchema.statics.getUserSettings = async function(userId) {
  let userSettings = await this.findOne({ id: userId });
  
  if (!userSettings) {
    // Si l'utilisateur n'a pas de paramètres, créer à partir des défauts
    const defaultSettings = await this.getDefaultSettings();
    
    if (defaultSettings) {
      userSettings = new this({
        id: userId,
        AntiAFK: { ...defaultSettings.AntiAFK },
        Movement: { ...defaultSettings.Movement }
      });
      await userSettings.save();
    } else {
      // Si pas de défauts non plus, créer avec les valeurs par défaut du schéma
      userSettings = new this({ id: userId });
      await userSettings.save();
    }
  }
  
  return userSettings;
};

settingSchema.statics.resetUserToDefault = async function(userId) {
  const defaultSettings = await this.getDefaultSettings();
  
  if (!defaultSettings) {
    throw new Error('Paramètres par défaut non trouvés');
  }
  
  const userSettings = await this.findOneAndUpdate(
    { id: userId },
    {
      AntiAFK: { ...defaultSettings.AntiAFK },
      Movement: { ...defaultSettings.Movement }
    },
    { 
      new: true, 
      upsert: true 
    }
  );
  
  return userSettings;
};

// Méthode pour initialiser les paramètres par défaut
settingSchema.statics.initializeDefaults = async function() {
  const existing = await this.findOne({ id: 'default' });
  
  if (!existing) {
    const defaultSettings = new this({
      id: 'default',
      AntiAFK: {
        delay_between_buttons: 2,
        interval: 60.6,
        left_bumper_duration: 1,
        right_bumper_duration: 1,
        antiafk_interval: 120
      },
      Movement: {
        ads_chance: 0.04,
        crouch_chance: 0.3,
        forward_bias: 0.4,
        forward_intensity: 2,
        jump_chance: 1,
        jump_interval: 10,
        look_intensity: 3,
        max_break_duration: 20,
        max_movement_duration: 14.817396002160994,
        min_break_duration: 10,
        min_movement_duration: 10,
        move_intensity: 2,
        shoot_chance: 0.1,
        shoot_duration: 0.298,
        strafe_chance: 0.25,
        weapon_switch_chance: 1,
        weapon_switch_interval: 15,
        x_button_chance: 0.3,
        x_button_interval: 5
      }
    });
    
    await defaultSettings.save();
    console.log('✅ Paramètres par défaut initialisés');
  }
};

module.exports = mongoose.model('Setting', settingSchema);